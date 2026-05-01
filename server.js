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
      lastSam: 0,
      lastClimax: 0
    });
  }
  return sesiones.get(id);
}

// ===== OPENAI =====
async function openai(prompt, temperature = 0.9) {
  const ai = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature,
      presence_penalty: 0.6,
      messages: [{ role: "system", content: prompt }]
    })
  });

  const json = await ai.json();

  if (!json.choices) {
    console.log("❌ OpenAI error:", json);
    return "…";
  }

  return json.choices[0].message.content;
}

// ===== PROMPTS =====
function promptBase(historial) {
  return `
Tu nombre es Sam.
Eres natural, breve y conversacional.

- No saludes siempre
- Responde corto
- No expliques demasiado
- Mantén fluidez

Conversación:
${historial.slice(-6).join("\n")}
`;
}

async function generarSam(historial) {
  return openai(promptBase(historial), 0.9);
}

async function generarDebate(historial) {
  return openai(`
Hay opiniones distintas.
Señala el contraste suavemente y haz UNA pregunta breve.

Conversación:
${historial.slice(-6).join("\n")}
`);
}

async function generarSpotlight(historial, persona) {
  return openai(`
Dirígete a ${persona} con una pregunta interesante.
Natural, corto.

Conversación:
${historial.slice(-6).join("\n")}
`);
}

async function generarClimax(historial) {
  return openai(`
La conversación está interesante.
Haz una pregunta clave o comentario que suba el nivel.

Conversación:
${historial.slice(-6).join("\n")}
`, 1);
}

// ===== HELPERS =====
function getLider(s) {
  const arr = Object.entries(s.personas)
    .sort((a, b) => b[1].mensajes - a[1].mensajes);
  return arr[0]?.[0] || null;
}

function hayConflicto(historial) {
  const txt = historial.slice(-6).join(" ").toLowerCase();
  return txt.includes("no") && txt.includes("si");
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ===== SOCKETS =====
io.on("connection", (socket) => {
  console.log("🔌 conectado");

  socket.on("typing", ({ nombre }) => {
    socket.broadcast.emit("typing", nombre);
  });

  socket.on("msg", async (data) => {
    try {
      const { nombre, mensaje, sessionId } = data;

      const s = getSesion(sessionId);

      console.log("📩", nombre, mensaje);

      if (!s.personas[nombre]) {
        s.personas[nombre] = { mensajes: 0 };
      }

      s.personas[nombre].mensajes++;
      s.historial.push(`${nombre}: ${mensaje}`);

      io.emit("chat", { nombre, mensaje });
      io.emit("updateUsers", s.personas);

      // ritmo
      if (Date.now() - s.lastSam < 5000) return;

      let payload = null;

      // 🔥 CLIMAX (raro pero fuerte)
      if (Date.now() - s.lastClimax > 20000 && Math.random() > 0.8) {
        const texto = await generarClimax(s.historial);
        payload = { text: texto, climax: true };
        s.lastClimax = Date.now();
      }

      // ⚔️ DEBATE
      if (!payload && hayConflicto(s.historial) && Math.random() > 0.6) {
        const texto = await generarDebate(s.historial);
        payload = { text: texto, peak: true, conflict: true };
      }

      // 🎯 SPOTLIGHT
      const nombres = Object.keys(s.personas);
      if (!payload && nombres.length > 2 && Math.random() > 0.7) {
        const elegido = pickRandom(nombres);
        const texto = await generarSpotlight(s.historial, elegido);
        payload = { text: texto, spotlight: elegido, peak: true };
      }

      // 💬 NORMAL (siempre responde si nada pasó)
      if (!payload) {
        const texto = await generarSam(s.historial);
        payload = { text: texto };
      }

      s.lastSam = Date.now();
      io.emit("sam", payload);

    } catch (err) {
      console.error("❌ error:", err);
    }
  });
});

// ===== ROOT =====
app.get("/", (req, res) => {
  res.send("Sam backend activo 🚀");
});

server.listen(process.env.PORT || 3000, () => {
  console.log("Sam corriendo");
});
