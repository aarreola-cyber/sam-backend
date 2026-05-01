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
  try {
    const prompt = `
Tu nombre es Sam.
Eres cálida, conversacional y natural.
Respondes corto.

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
        temperature: 1,
        messages: [{ role: "system", content: prompt }]
      })
    });

    const json = await ai.json();

    if (!json.choices) {
      console.log("ERROR OPENAI:", json);
      return "mm... algo raro pasó, pero sigo aquí.";
    }

    return json.choices[0].message.content;

  } catch (err) {
    console.error("ERROR SAM:", err);
    return "no pude responder bien... pero sigo aquí.";
  }
}

// ===== VOZ =====
async function generarVoz(texto) {
  try {
    const voz = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${process.env.VOICE_ID}`,
      {
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
      }
    );

    const buffer = await voz.arrayBuffer();
    return Buffer.from(buffer).toString("base64");

  } catch (err) {
    console.error("ERROR VOZ:", err);
    return null; // 👈 importante
  }
}

// ===== SOCKETS =====
io.on("connection", (socket) => {

  socket.on("msg", async (data) => {
    try {
      const { nombre, mensaje, sessionId } = data;

      const s = getSesion(sessionId);

      if (!s.personas[nombre]) {
        s.personas[nombre] = { mensajes: 0 };
      }

      s.personas[nombre].mensajes++;
      s.historial.push(`${nombre}: ${mensaje}`);

      // mensaje humano
      io.emit("chat", { nombre, mensaje });

      // Sam responde a veces (natural)
      if (Math.random() > 0.4) {
        const texto = await generarSam(s.historial);
        const audio = await generarVoz(texto);

        io.emit("sam", { text: texto, audio });
      }

    } catch (err) {
      console.error("ERROR SOCKET:", err);
    }
  });

});

// ===== ENDPOINT TEST =====
app.post("/chat", async (req, res) => {
  try {
    const { mensaje, nombre, sessionId } = req.body;

    const s = getSesion(sessionId);
    s.historial.push(`${nombre}: ${mensaje}`);

    const texto = await generarSam(s.historial);
    const audio = await generarVoz(texto);

    res.json({ text: texto, audio });

  } catch (err) {
    console.error("ERROR /chat:", err);
    res.status(500).json({ error: "falló backend" });
  }
});

// ===== ROOT =====
app.get("/", (req, res) => {
  res.send("Sam backend activo 🚀");
});

// ===== START =====
server.listen(process.env.PORT || 3000, () => {
  console.log("Sam corriendo");
});
