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
      historial: []
    });
  }
  return sesiones.get(id);
}

// ===== FUNCIÓN IA =====
async function generarSam(historial) {
  const prompt = `
Tu nombre es Sam.
Eres cálida, conversacional, inteligente.
Respondes corto.
No respondes a todo.

Conversación:
${historial.slice(-6).join("\n")}
`;

  const ai = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-5.3",
      temperature: 1,
      messages: [{ role: "system", content: prompt }]
    })
  });

  const json = await ai.json();
  return json.choices[0].message.content;
}

// ===== FUNCIÓN VOZ =====
async function generarVoz(texto) {
  const voz = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${process.env.VOICE_ID}`, {
    method: "POST",
    headers: {
      "xi-api-key": process.env.ELEVEN_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      text: texto,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.8
      }
    })
  });

  const buffer = await voz.arrayBuffer();
  return Buffer.from(buffer).toString("base64");
}

// ===== SOCKETS (EVENTO REAL) =====
io.on("connection", (socket) => {

  socket.on("msg", async (data) => {
    const { nombre, mensaje, sessionId } = data;

    const s = getSesion(sessionId);

    if (!s.personas[nombre]) {
      s.personas[nombre] = { mensajes: 0 };
    }

    s.personas[nombre].mensajes++;
    s.historial.push(`${nombre}: ${mensaje}`);

    // broadcast humano
    io.emit("chat", { nombre, mensaje });

    // Sam decide si responde (natural)
    if (Math.random() > 0.4) {
      const texto = await generarSam(s.historial);
      const audio = await generarVoz(texto);

      io.emit("sam", { text: texto, audio });
    }
  });

});

// ===== ENDPOINT PARA PRUEBAS (curl) =====
app.post("/chat", async (req, res) => {
  const { mensaje, nombre, sessionId } = req.body;

  const s = getSesion(sessionId);

  s.historial.push(`${nombre}: ${mensaje}`);

  const texto = await generarSam(s.historial);
  const audio = await generarVoz(texto);

  res.json({ text: texto, audio });
});

// ===== TEST SIMPLE =====
app.get("/", (req, res) => {
  res.send("Sam backend activo");
});

// ===== START =====
server.listen(process.env.PORT || 3000, () => {
  console.log("Sam corriendo");
});
