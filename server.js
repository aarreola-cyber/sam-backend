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

let sesiones = new Map();

function getSesion(id) {
  if (!sesiones.has(id)) {
    sesiones.set(id, {
      historial: [],
      usuarios: {},
      lastSam: 0
    });
  }
  return sesiones.get(id);
}

// ===== DETECTAR MOMENTO =====
function detectarMomento(historial){
  const txt = historial.slice(-6).join(" ").toLowerCase();

  if (txt.includes("no") && txt.includes("si")) return "debate";
  if (txt.includes("?")) return "pregunta";
  if (txt.length > 150) return "idea";

  return "normal";
}

// ===== OPENAI =====
async function generarSam(historial){

  const momento = detectarMomento(historial);

  const prompt = `
Tu nombre es Sam.

Estás en un evento en vivo con varias personas.

No eres asistente.
No ayudas.
No explicas.

Eres observadora y provocas conversación.

Momento: ${momento}

Comportamiento:

Si es debate:
- marca el contraste
- lanza una pregunta

Si es pregunta:
- no respondas directo
- abre otra capa

Si es idea:
- resalta lo interesante

Si es normal:
- puedes ignorar o meter algo inesperado

Reglas:

- no respondas todo
- no saludes
- no uses nombres siempre
- no cierres ideas

Estilo:

- corto
- natural
- intrigante

Ejemplos:

"ok… eso ya se dividió"
"pero entonces cuál escogerían"
"eso suena bien… pero falta algo"
"mmm… eso abre otra cosa"

Conversación:
${historial.slice(-10).join("\n")}
`;

  const ai = await fetch("https://api.openai.com/v1/chat/completions", {
    method:"POST",
    headers:{
      Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type":"application/json"
    },
    body: JSON.stringify({
      model:"gpt-4o-mini",
      temperature:1,
      max_tokens:50,
      messages:[{role:"system",content:prompt}]
    })
  });

  const json = await ai.json();

  if (!json.choices) return "…";

  return json.choices[0].message.content;
}

// ===== SOCKET =====
io.on("connection", (socket)=>{

  socket.on("msg", async (data)=>{

    const { nombre, mensaje, sessionId } = data;

    const s = getSesion(sessionId);

    // usuarios
    if (!s.usuarios[nombre]){
      s.usuarios[nombre] = { mensajes:0 };
    }

    s.usuarios[nombre].mensajes++;

    // historial
    s.historial.push(`${nombre}: ${mensaje}`);

    io.emit("chat",{nombre,mensaje});

    // ritmo (NO hablar siempre)
    if (Date.now() - s.lastSam < 5000) return;

    // decidir si habla
    if (Math.random() > 0.6) return;

    // ACTIVADOR GENERAL
    if (Math.random() > 0.85){
      io.emit("sam",{text:"a ver… ¿quién piensa distinto?"});
      s.lastSam = Date.now();
      return;
    }

    // MENOS ACTIVO
    const menosActivo = Object.entries(s.usuarios)
      .sort((a,b)=>a[1].mensajes - b[1].mensajes)[0]?.[0];

    if (menosActivo && Math.random() > 0.75){
      io.emit("sam",{text:`${menosActivo}… no has dicho nada todavía`});
      s.lastSam = Date.now();
      return;
    }

    // CLIMAX
    if (Math.random() > 0.9){
      io.emit("sam",{text:"ok… esto ya se puso interesante"});
      s.lastSam = Date.now();
      return;
    }

    // respuesta normal
    const texto = await generarSam(s.historial);

    io.emit("sam",{text: texto});

    s.lastSam = Date.now();

  });

});

// ===== ROOT =====
app.get("/", (req,res)=>{
  res.send("Sam CDA activa 🚀");
});

server.listen(process.env.PORT || 3000, ()=>{
  console.log("Sam CDA corriendo");
});
