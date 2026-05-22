import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';

const app = express();
app.use(cors()); 
app.use(express.json());

// 🔒 Reads your free Gemini key safely from Render settings
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 

app.post('/api/chat', async (req, res) => {
  try {
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: "Gemini API key missing on the server backend." });
    }

    // Convert Anthropic history layout to Gemini layout format
    const { system, messages } = req.body;
    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    // Call Google Gemini API
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: contents,
        systemInstruction: { parts: [{ text: system }] }
      })
    });

    const data = await response.json();
    const replyText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Format response back exactly how nexa-ai.js expects it
    res.json({
      content: [{ type: 'text', text: replyText }]
    });

  } catch (error) {
    console.error("Proxy error:", error);
    res.status(500).json({ error: "Backend proxy error." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✦ Free Gemini Proxy running on port ${PORT}`);
});