import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// ===== SESIONES =====
let sesiones = new Map();

function getSesion(id) {
  if (!sesiones.has(id)) {
    sesiones.set(id, {
      historial: []
    });
  }
  return sesiones.get(id);
}

// ===== SOCKET =====
io.on("connection", (socket) => {

  const sessionId = "evento-cda";
  const s = getSesion(sessionId);

  // 🔥 INICIO (solo una vez)
  if (!s.iniciado) {
    s.iniciado = true;

    setTimeout(() => {
      io.emit("sam", { text: "hey…" });

      setTimeout(() => {
        io.emit("sam", { text: "cómo se llaman" });
      }, 1200);

    }, 1000);
  }

  socket.on("msg", (data) => {

    const { nombre, mensaje } = data;

    // guardar historial
    s.historial.push(`${nombre}: ${mensaje}`);

    // mandar mensaje
    io.emit("chat", { nombre, mensaje });

    const ultimos = s.historial.slice(-6).join(" ").toLowerCase();

    let respuesta = null;

    // 🔥 1. DETECTA DEBATE
    if (ultimos.includes("no") && ultimos.includes("si")) {
      respuesta = "mmm… entonces no están viendo lo mismo… cuál elegirían";
    }

    // 🔥 2. PREGUNTA
    else if (mensaje.includes("?")) {
      respuesta = "no sé si es eso… tú qué crees";
    }

    // 🔥 3. MUY SIMPLE
    else if (mensaje.length < 8) {
      respuesta = "ok… pero eso no dice mucho… por qué";
    }

    // 🔥 4. DEFAULT (HER)
    else {
      respuesta = "mmm… suena bien… pero siento que falta algo";
    }

    setTimeout(() => {
      io.emit("sam", { text: respuesta });
    }, 1200);

  });

});

// ===== RITMO AUTOMÁTICO =====
setInterval(() => {

  const s = getSesion("evento-cda");

  if (!s || s.historial.length < 2) return;

  const ultimos = s.historial.slice(-6).join(" ").toLowerCase();

  let texto = null;

  // 🔥 si hay debate → empuja
  if (ultimos.includes("no") && ultimos.includes("si")) {
    texto = "ok… entonces cuál escogerían si tuvieran que decidir ya";
  }

  // 🔥 si todo plano → provocar
  else if (Math.random() > 0.5) {
    texto = "a ver… alguien que piense distinto";
  }

  // 🔥 otro empuje ligero
  else if (Math.random() > 0.5) {
    texto = "eso suena bien… pero qué falta";
  }

  if (!texto) return;

  io.emit("sam", { text: texto });

}, 9000);

// ===== ROOT =====
app.get("/", (req, res) => {
  res.send("Sam HER + Moderadora activa 🚀");
});

// ===== SERVER =====
server.listen(process.env.PORT || 3000, () => {
  console.log("Server corriendo");
});
