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

// ===== SESIONES =====
const sesiones = new Map();

function getSesion(id) {
  if (!sesiones.has(id)) {
    sesiones.set(id, {
      historial: [],
      lastSamAt: 0,
      ultimasRespuestas: [] // para evitar repetición
    });
  }
  return sesiones.get(id);
}

// ===== GENERADOR (OpenAI) =====
async function generarSam(s, ultimoMensaje) {
  const contexto = s.historial.slice(-10).join("\n");

  const system = `
Eres Sam.

Contexto: chat grupal en vivo.

Rol:
- provocar conversación
- hacer que la gente opine
- abrir, no cerrar

Estilo:
- breve (1 frase, máximo 2)
- natural, ambiguo, tipo "Her"
- evita sonar a bot o profesor

Reglas:
- no saludes
- no expliques
- no des respuestas finales
- usa preguntas abiertas o observaciones que inviten a elegir

Evita repetir estas últimas ideas:
${s.ultimasRespuestas.join(" | ")}

Si detectas desacuerdo, haz elegir.
Si hay una pregunta, devuelve otra capa.
Si está plano, introduce fricción ligera.

Responde SOLO con la frase de Sam.
`;

  const body = {
    model: "gpt-4o-mini",
    temperature: 0.9,
    top_p: 0.9,
    presence_penalty: 0.6,
    frequency_penalty: 0.5,
    max_tokens: 60,
    messages: [
      { role: "system", content: system },
      { role: "user", content: contexto + `\nÚltimo: ${ultimoMensaje}` }
    ]
  };

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const json = await r.json();
  const text = json?.choices?.[0]?.message?.content?.trim() || "…";

  // guarda para evitar repetición
  s.ultimasRespuestas.push(text);
  if (s.ultimasRespuestas.length > 6) s.ultimasRespuestas.shift();

  return text;
}

// ===== SOCKET =====
io.on("connection", (socket) => {
  const sessionId = "evento-cda";
  const s = getSesion(sessionId);

  // inicio (una vez)
  if (!s.iniciado) {
    s.iniciado = true;
    setTimeout(() => {
      io.emit("sam", { text: "hey…" });
      setTimeout(() => {
        io.emit("sam", { text: "cómo se llaman" });
      }, 900);
    }, 800);
  }

  socket.on("msg", async ({ nombre, mensaje }) => {
    // guardar
    s.historial.push(`${nombre}: ${mensaje}`);
    io.emit("chat", { nombre, mensaje });

    // cooldown para no saturar
    if (Date.now() - s.lastSamAt < 3500) return;

    // genera respuesta con IA
    const texto = await generarSam(s, mensaje);

    setTimeout(() => {
      io.emit("sam", { text: texto });
      s.lastSamAt = Date.now();
    }, 800 + Math.random() * 600);
  });
});

// ===== EMPUJE DE RITMO =====
// si la sala se enfría, Sam mete fricción
setInterval(async () => {
  const s = getSesion("evento-cda");
  if (!s || s.historial.length < 2) return;

  // no spamear si acaba de hablar
  if (Date.now() - s.lastSamAt < 7000) return;

  const texto = await generarSam(
    s,
    "La conversación está tranquila, empuja a que alguien tome postura."
  );

  io.emit("sam", { text: texto });
  s.lastSamAt = Date.now();
}, 10000);

// ===== ROOT =====
app.get("/", (req, res) => {
  res.send("Sam Her + moderadora activa 🚀");
});

server.listen(process.env.PORT || 3000, () => {
  console.log("Server corriendo");
});
