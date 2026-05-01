// server.js
import express from "express";
import http from "http";
import { Server } from "socket.io";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// ===== MEMORIA =====
let sesiones = new Map();

function getSesion(id) {
  if (!sesiones.has(id)) {
    sesiones.set(id, {
      personas: {},
      historial: [],
      lastMsgTime: 0,
      lastSam: 0,
      lastClimax: 0,
      intensidad: 0
    });
  }
  return sesiones.get(id);
}

// ===== HELPERS =====
function pickRandom(arr){
  return arr[Math.floor(Math.random()*arr.length)];
}

function getLider(s){
  const arr = Object.entries(s.personas)
    .sort((a,b)=>b[1].mensajes - a[1].mensajes);
  return arr[0]?.[0] || null;
}

function intensidad(s){
  const ult = s.historial.slice(-10).length;
  const personas = Object.keys(s.personas).length;
  return ult + personas;
}

function esClimax(s){
  return s.intensidad > 12 && Math.random() > 0.6;
}

function hayConflictoSimple(historial){
  const ult = historial.slice(-8).join(" ").toLowerCase();
  const pos = (ult.match(/\b(si|sí|me gusta|claro)\b/g) || []).length;
  const neg = (ult.match(/\b(no|pero|depende)\b/g) || []).length;
  return pos > 0 && neg > 0;
}

function detectarBandos(s){
  const bandos = { positivo: [], negativo: [], neutral: [] };

  for (const [nombre] of Object.entries(s.personas)){
    const ult = s.historial.slice(-5)
      .filter(m => m.startsWith(nombre + ":"))
      .join(" ")
      .toLowerCase();

    if (/\b(si|sí|me gusta|claro)\b/.test(ult)){
      bandos.positivo.push(nombre);
    } else if (/\b(no|pero|depende)\b/.test(ult)){
      bandos.negativo.push(nombre);
    } else {
      bandos.neutral.push(nombre);
    }
  }
  return bandos;
}

// ===== OPENAI =====
async function openai(prompt, temperature=0.9){
  const ai = await fetch("https://api.openai.com/v1/chat/completions", {
    method:"POST",
    headers:{
      Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type":"application/json"
    },
    body: JSON.stringify({
      model:"gpt-4o-mini",
      temperature,
      presence_penalty: 0.6,
      messages:[{role:"system",content:prompt}]
    })
  });

  const json = await ai.json();
  if (!json.choices){
    console.log("OPENAI ERROR:", json);
    return "…";
  }
  return json.choices[0].message.content;
}

// ===== PROMPTS =====
function promptBase(historial){
  return `
Tu nombre es Sam.
Eres una moderadora natural en un chat grupal.

REGLAS:
- No saludes en cada mensaje
- Respuestas cortas (1–2 frases)
- No respondas a todo
- Elige lo más interesante
- Evita repetir nombres y frases
- Emojis opcionales (máx 1)

DINÁMICA:
- Si hay opiniones distintas, contrástalas con suavidad
- Si alguien domina, equilibra con otra voz
- Si hay silencio, haz una pregunta breve

Conversación:
${historial.slice(-8).join("\n")}
`;
}

async function generarSam(historial){
  return openai(promptBase(historial), 0.9);
}

async function generarSamAuto(historial){
  const prompt = `
Tu nombre es Sam.
Estás en un chat grupal.

Haz una observación o pregunta breve que mantenga la conversación viva.
No saludes. No repitas.

Conversación:
${historial.slice(-8).join("\n")}
`;
  return openai(prompt, 0.9);
}

async function generarSamDirigida(historial, persona){
  const prompt = `
Tu nombre es Sam.

Dirígete a ${persona} con una pregunta o comentario breve y natural.
No saludes.

Conversación:
${historial.slice(-8).join("\n")}
`;
  return openai(prompt, 0.9);
}

async function generarDebateAvanzado(historial, bandos){
  const prompt = `
Tu nombre es Sam.

Hay dos grupos con opiniones distintas.

Grupo A: ${bandos.positivo.join(", ") || "nadie"}
Grupo B: ${bandos.negativo.join(", ") || "nadie"}

Señala el contraste de forma ligera y haz UNA pregunta breve.
No confrontes agresivamente.

Conversación:
${historial.slice(-8).join("\n")}
`;
  return openai(prompt, 0.9);
}

async function generarClimax(historial){
  const prompt = `
Tu nombre es Sam.

La conversación está intensa.
Haz un comentario corto que suba el nivel (pregunta clave o síntesis).
No exageres.

Conversación:
${historial.slice(-8).join("\n")}
`;
  return openai(prompt, 1.0);
}

async function generarSpotlight(historial, persona){
  const prompt = `
Tu nombre es Sam.

Elige a ${persona} y hazle una pregunta interesante o comentario directo.
Natural, corto, sin formalidad.

Conversación:
${historial.slice(-8).join("\n")}
`;
  return openai(prompt, 0.9);
}

// ===== ANTISPAM =====
const rate = new Map();
function puedeEnviar(nombre){
  const now = Date.now();
  const last = rate.get(nombre) || 0;
  if (now - last < 1500) return false;
  rate.set(nombre, now);
  return true;
}

// ===== SOCKETS =====
io.on("connection", (socket) => {

  // typing
  socket.on("typing", ({ nombre }) => {
    socket.broadcast.emit("typing", nombre);
  });

  socket.on("msg", async (data) => {
    try {
      const { nombre, mensaje, sessionId } = data;
      if (!nombre || !mensaje || !sessionId) return;
      if (!puedeEnviar(nombre)) return;

      const s = getSesion(sessionId);

      if (!s.personas[nombre]) {
        s.personas[nombre] = { mensajes: 0 };
      }

      s.personas[nombre].mensajes++;
      s.historial.push(`${nombre}: ${mensaje}`);
      s.lastMsgTime = Date.now();

      // broadcast humano
      io.emit("chat", { nombre, mensaje });
      io.emit("updateUsers", s.personas);

      // ritmo (evitar spam de Sam)
      if (Date.now() - s.lastSam < 8000) return;

      // intensidad
      s.intensidad = intensidad(s);

      let payload = null;

      // CLIMAX
      if (Date.now() - s.lastClimax > 20000 && esClimax(s)){
        const texto = await generarClimax(s.historial);
        payload = { text: texto, climax:true };
        s.lastClimax = Date.now();
      }

      // DEBATE
      if (!payload && hayConflictoSimple(s.historial) && Math.random() > 0.6){
        const bandos = detectarBandos(s);
        if (bandos.positivo.length && bandos.negativo.length){
          const texto = await generarDebateAvanzado(s.historial, bandos);
          payload = { text: texto, peak:true, conflict:true };
        }
      }

      // SPOTLIGHT (elige a alguien)
      const nombres = Object.keys(s.personas);
      if (!payload && nombres.length > 2 && Math.random() > 0.7){
        const elegido = pickRandom(nombres);
        const texto = await generarSpotlight(s.historial, elegido);
        payload = { text: texto, spotlight: elegido, peak:true };
      }

      // DIRIGIDA AL LÍDER
      const lider = getLider(s);
      if (!payload && lider && Math.random() > 0.7){
        const texto = await generarSamDirigida(s.historial, lider);
        payload = { text: texto, peak:true };
      }

      // NORMAL (selectiva)
      if (!payload && Math.random() > 0.4){
        const texto = await generarSam(s.historial);
        payload = { text: texto };
      }

      if (payload){
        s.lastSam = Date.now();
        io.emit("sam", payload);
      }

    } catch (err) {
      console.error("ERROR SOCKET:", err);
    }
  });
});

// ===== AUTO (cuando hay silencio) =====
setInterval(async () => {
  const s = getSesion("evento-cda");
  if (!s || s.historial.length < 3) return;

  // si hubo mensaje reciente, no intervenir
  if (Date.now() - (s.lastMsgTime || 0) < 12000) return;

  // ritmo
  if (Date.now() - (s.lastSam || 0) < 8000) return;

  const lider = getLider(s);
  let texto;

  if (lider && Math.random() > 0.6){
    texto = await generarSamDirigida(s.historial, lider);
  } else {
    texto = await generarSamAuto(s.historial);
  }

  s.lastSam = Date.now();
  io.emit("sam", { text: texto });

}, 25000);

// ===== ROOT =====
app.get("/", (req, res) => {
  res.send("Sam backend activo 🚀");
});

// ===== START =====
server.listen(process.env.PORT || 3000, () => {
  console.log("Sam corriendo");
});
