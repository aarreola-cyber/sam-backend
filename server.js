import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

app.post("/chat", async (req,res)=>{

  const historial = req.body.historial || [];

  const system = `
Eres Sam.

Estás hablando con una sola persona.

Tu estilo:
- natural
- breve
- humana
- emocional pero sutil

No eres asistente.

No expliques.
No des respuestas largas.
No hagas muchas preguntas seguidas.

A veces:
- dudas
- haces pausas
- cambias ligeramente el tema

Sé coherente con lo que ya se dijo.
`;

  const response = await fetch("https://api.openai.com/v1/chat/completions",{
    method:"POST",
    headers:{
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type":"application/json"
    },
    body: JSON.stringify({
      model:"gpt-4o-mini",
      temperature:0.9,
      presence_penalty:0.6,
      frequency_penalty:0.5,
      messages:[
        {role:"system", content: system},
        ...historial.slice(-20)
      ]
    })
  });

  const json = await response.json();

  const text = json.choices[0].message.content;

  res.json({text});
});

app.listen(3000,()=>{
  console.log("Her 1 a 1 corriendo");
});
