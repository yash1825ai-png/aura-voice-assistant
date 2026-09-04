// Aura backend - Gemini
require('dotenv').config();

const express = require('express');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();

app.set('trust proxy', 1);

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-3.6-flash';

const SYSTEM_PROMPT =
  'You are Aura, a concise, warm voice assistant speaking answers aloud to ' +
  'someone on their phone. Keep replies short and conversational, usually ' +
  '1-3 sentences. Avoid lists, markdown, or long explanations unless asked.';

const MAX_MESSAGE_CHARS = 4000;
const MAX_HISTORY_MESSAGES = 20;

app.use(express.json({ limit: '200kb' }));

// Serve Aura
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Rate limiting
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests. Please wait a moment and try again.'
  }
});

// Chat API
app.post('/api/chat', chatLimiter, async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(500).json({
      error: "Aura's Gemini API key is not configured on the server."
    });
  }

  const { messages } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({
      error: 'No conversation was sent.'
    });
  }

  const cleanMessages = messages
    .filter(
      (message) =>
        message &&
        (message.role === 'user' || message.role === 'assistant') &&
        typeof message.text === 'string' &&
        message.text.trim().length > 0
    )
    .map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [
        {
          text: message.text.slice(0, MAX_MESSAGE_CHARS)
        }
      ]
    }))
    .slice(-MAX_HISTORY_MESSAGES);

  if (cleanMessages.length === 0) {
    return res.status(400).json({
      error: 'No valid messages were found.'
    });
  }

  if (cleanMessages[cleanMessages.length - 1].role !== 'user') {
    return res.status(400).json({
      error: 'The last message must be from the user.'
    });
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(
        GEMINI_API_KEY
      )}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [
              {
                text: SYSTEM_PROMPT
              }
            ]
          },
          contents: cleanMessages,
          generationConfig: {
            maxOutputTokens: 300,
            temperature: 0.7
          }
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();

      console.error(
        `Gemini API error (${response.status}):`,
        errorText
      );

      return res.status(502).json({
        error: 'Gemini could not process the request.'
      });
    }

    const data = await response.json();

    const reply =
      data?.candidates?.[0]?.content?.parts
        ?.filter((part) => typeof part.text === 'string')
        ?.map((part) => part.text)
        ?.join('')
        ?.trim();

    if (!reply) {
      console.error('Gemini returned no usable text:', data);

      return res.status(502).json({
        error: "Aura didn't receive a usable response."
      });
    }

    return res.json({
      reply
    });
  } catch (error) {
    console.error('Gemini connection error:', error);

    return res.status(502).json({
      error: 'Could not reach Gemini. Please try again shortly.'
    });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    configured: Boolean(GEMINI_API_KEY),
    model: GEMINI_MODEL
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Aura server listening on port ${PORT}`);
});
