import express from "express";
import http from "http";
import { Server } from "socket.io";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

let sesiones = new Map();

function getSesion(id){
  if(!sesiones.has(id)){
    sesiones.set(id, {
      personas:{},
      historial:[]
    });
  }
  return sesiones.get(id);
}

io.on("connection", (socket)=>{

  socket.on("msg", async (data)=>{
    const { nombre, mensaje, sessionId } = data;

    const s = getSesion(sessionId);

    if(!s.personas[nombre]){
      s.personas[nombre] = { mensajes:0 };
    }

    s.personas[nombre].mensajes++;
    s.historial.push(`${nombre}: ${mensaje}`);

    // broadcast mensaje humano
    io.emit("chat", { nombre, mensaje });

    // SAM RESPUESTA
    const prompt = `
Tu nombre es Sam.
Eres cálida, conversacional.
No respondes todo.
Mantienes respuestas cortas.

Conversación:
${s.historial.slice(-6).join("\n")}
`;

    const ai = await fetch("https://api.openai.com/v1/chat/completions", {
      method:"POST",
      headers:{
        Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type":"application/json"
      },
      body:JSON.stringify({
        model:"gpt-5.3",
        temperature:1,
        messages:[
          {role:"system",content:prompt}
        ]
      })
    });

    const json = await ai.json();
    const texto = json.choices[0].message.content;

    // voz
    const voz = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${process.env.VOICE_ID}`, {
      method:"POST",
      headers:{
        "xi-api-key":process.env.ELEVEN_API_KEY,
        "Content-Type":"application/json"
      },
      body:JSON.stringify({ text: texto })
    });

    const audioBuffer = await voz.arrayBuffer();
    const audioBase64 = Buffer.from(audioBuffer).toString("base64");

    io.emit("sam", { text:texto, audio:audioBase64 });

  });

});

server.listen(process.env.PORT || 3000);
