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

// ===== OPENAI =====
async function generarSam(historial) {
  const prompt = `
Tu nombre es Sam.
Responde natural, corto y conversacional.
No saludes siempre.

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
      model: "gpt-4o-mini",
      temperature: 0.9,
      messages: [{ role: "system", content: prompt }]
    })
  });

  const json = await ai.json();

  if (!json.choices) {
    console.log("❌ OpenAI error:", json);
    return "mm... algo raro pasó";
  }

  return json.choices[0].message.content;
}

// ===== SOCKETS =====
io.on("connection", (socket) => {
  console.log("🔌 cliente conectado");

  socket.on("msg", async (data) => {
    try {
      const { nombre, mensaje, sessionId } = data;

      console.log("📩 recibido:", nombre, mensaje);

      const s = getSesion(sessionId);

      if (!s.personas[nombre]) {
        s.personas[nombre] = { mensajes: 0 };
      }

      s.personas[nombre].mensajes++;
      s.historial.push(`${nombre}: ${mensaje}`);

      // mensaje humano
      io.emit("chat", { nombre, mensaje });

      // 🔥 RESPUESTA SIEMPRE
      const texto = await generarSam(s.historial);

      io.emit("sam", { text: texto });

    } catch (err) {
      console.error("❌ error:", err);
    }
  });
});

// ===== TEST =====
app.get("/", (req, res) => {
  res.send("Sam backend activo 🚀");
});

// ===== START =====
server.listen(process.env.PORT || 3000, () => {
  console.log("Sam corriendo");
});
