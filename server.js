// Aura backend - Gemini
require('dotenv').config();

const express = require('express');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();

app.set('trust proxy', 1);

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-2.5-flash';

const SYSTEM_PROMPT =
  "You are Aura, a concise, warm voice assistant speaking answers aloud to " +
  "someone on their phone. Keep replies short and conversational, usually " +
  "1-3 sentences. Avoid lists, markdown, or long explanations unless asked.";

const MAX_MESSAGE_CHARS = 4000;
const MAX_HISTORY_MESSAGES = 20;

app.use(express.json({ limit: '200kb' }));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Wait a moment and try again.' }
});

app.post('/api/chat', chatLimiter, async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(500).json({
      error: "Aura's server isn't configured yet. Add GEMINI_API_KEY in Render."
    });
  }

  const { messages } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'No conversation was sent.' });
  }

  const cleanMessages = messages
    .filter(m =>
      m &&
      (m.role === 'user' || m.role === 'assistant') &&
      typeof m.text === 'string'
    )
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.text.slice(0, MAX_MESSAGE_CHARS) }]
    }))
    .slice(-MAX_HISTORY_MESSAGES);

  if (!cleanMessages.length) {
    return res.status(400).json({ error: 'No valid messages were found.' });
  }

  if (cleanMessages[cleanMessages.length - 1].role !== 'user') {
    return res.status(400).json({
      error: 'The last message must be from the user.'
    });
  }

  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: SYSTEM_PROMPT }]
          },
          contents: cleanMessages,
          generationConfig: {
            maxOutputTokens: 300
          }
        })
      }
    );

    if (!upstream.ok) {
      const detail = await upstream.text();
      console.error('Gemini API error:', upstream.status, detail);

      return res.status(502).json({
        error: 'The Gemini assistant service returned an error.'
      });
    }

    const data = await upstream.json();

    const reply =
      data?.candidates?.[0]?.content?.parts
        ?.filter(part => typeof part.text === 'string')
        ?.map(part => part.text)
        ?.join('')
        ?.trim() ||
      "I didn't get a proper response that time.";

    res.json({ reply });

  } catch (err) {
    console.error('Failed to reach Gemini API:', err);

    res.status(502).json({
      error: "Couldn't reach the assistant service. Try again shortly."
    });
  }
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    configured: Boolean(GEMINI_API_KEY)
  });
});

app.listen(PORT, () => {
  console.log(`Aura server listening on port ${PORT}`);
});
