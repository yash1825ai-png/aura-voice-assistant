// Aura backend
// ---------------------------------------------------------------
// Serves the static frontend and exposes POST /api/chat, which is
// the ONLY place the Anthropic API key is used. The key lives in
// an environment variable and is never sent to the browser.
// ---------------------------------------------------------------

require('dotenv').config();

const express = require('express');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();

// Render/Heroku/most PaaS hosts sit behind a reverse proxy — this
// makes req.ip and the rate limiter reflect the real client IP.
app.set('trust proxy', 1);

const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const ANTHROPIC_VERSION = '2023-06-01';

const SYSTEM_PROMPT =
  "You are Aura, a concise, warm voice assistant speaking answers aloud to " +
  "someone on their phone. Keep replies short and conversational (usually " +
  "1-3 sentences) since they will be read aloud with text-to-speech. Avoid " +
  "lists, markdown, or long explanations unless the person clearly asks for detail.";

const MAX_MESSAGE_CHARS = 4000;
const MAX_HISTORY_MESSAGES = 20; // caps token usage / cost per request

app.use(express.json({ limit: '200kb' }));

// Serve the frontend
app.use(express.static(path.join(__dirname, 'public')));

// Basic abuse protection for the paid upstream API.
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20, // 20 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Wait a moment and try again.' }
});

app.post('/api/chat', chatLimiter, async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set.');
    return res.status(500).json({
      error: "Aura's server isn't configured yet. The site owner needs to set ANTHROPIC_API_KEY."
    });
  }

  const { messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'No conversation was sent.' });
  }

  // Sanitize and cap what we forward upstream.
  const cleanMessages = messages
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
    .map(m => ({ role: m.role, content: m.text.slice(0, MAX_MESSAGE_CHARS) }))
    .slice(-MAX_HISTORY_MESSAGES);

  if (!cleanMessages.length) {
    return res.status(400).json({ error: 'No valid messages were found in the request.' });
  }
  if (cleanMessages[cleanMessages.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'The last message must be from the user.' });
  }

  let upstream;
  try {
    upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': ANTHROPIC_VERSION
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: cleanMessages
      })
    });
  } catch (networkErr) {
    console.error('Failed to reach Anthropic API:', networkErr);
    return res.status(502).json({ error: "Couldn't reach the assistant service. Try again shortly." });
  }

  if (!upstream.ok) {
    let detail = '';
    try { detail = await upstream.text(); } catch (e) { /* ignore */ }
    console.error('Anthropic API error', upstream.status, detail);
    const message = upstream.status === 401 || upstream.status === 403
      ? "Aura's server has an invalid API key. The site owner needs to check ANTHROPIC_API_KEY."
      : 'The assistant service returned an error. Try again in a moment.';
    return res.status(502).json({ error: message });
  }

  let data;
  try {
    data = await upstream.json();
  } catch (parseErr) {
    console.error('Failed to parse Anthropic response:', parseErr);
    return res.status(502).json({ error: 'Got an unreadable response from the assistant service.' });
  }

  const textBlock = (data.content || []).find(b => b.type === 'text');
  const reply = textBlock ? textBlock.text.trim() : "I didn't get a proper response that time.";
  res.json({ reply });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, configured: Boolean(ANTHROPIC_API_KEY) });
});

app.listen(PORT, () => {
  console.log(`Aura server listening on port ${PORT}`);
  if (!ANTHROPIC_API_KEY) {
    console.warn('WARNING: ANTHROPIC_API_KEY is not set — /api/chat will return an error until it is.');
  }
});
