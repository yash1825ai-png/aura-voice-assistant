# Aura — Voice AI Assistant

A premium, mobile-first voice assistant web app. Tap the mic, speak, get a
spoken reply from Claude. This version moves the AI call to a backend so no
API key ever ships to the browser.

## What changed from the prototype

- The frontend no longer calls the Anthropic API directly. It calls its own
  `POST /api/chat` endpoint.
- A small Express server (`server.js`) holds the Anthropic API key as an
  environment variable and makes the real call to Claude server-side.
- Conversation history and settings are saved with the browser's own
  `localStorage`, so they survive a page reload on your device.
- The UI, mic animation, state machine (listening / thinking / speaking),
  and text-to-speech are unchanged.
- Reminders, Gmail, Calendar, and WhatsApp are still just labeled "Planned"
  in Settings — not implemented, not wired to anything.

## Project structure

```
aura/
├── public/
│   └── index.html      the entire frontend (UI, mic logic, TTS)
├── server.js            Express server + /api/chat
├── package.json
├── .env.example          template for required environment variables
├── .gitignore
└── README.md
```

## Requirements

- Node.js 18 or later (needed for the built-in `fetch` used in `server.js`)
- An Anthropic API key from https://console.anthropic.com/settings/keys
- An HTTPS hosting environment for real-world use (see below — this is not
  optional, it's a browser requirement)

## Run it locally

```bash
cd aura
npm install
cp .env.example .env
# edit .env and paste in your real ANTHROPIC_API_KEY
npm start
```

Open `http://localhost:3000`. Voice input works on `localhost` even without
HTTPS, because browsers treat `localhost` as a secure context. Text-to-speech
and the chat backend can be exercised fully at this stage.

## Deploying to HTTPS hosting

Any host that runs a Node process and terminates HTTPS for you works. Two
concrete paths:

### Option A — Render.com (simplest, free tier available)

1. Push this project to a GitHub repository (make sure `.env` is **not**
   committed — `.gitignore` already excludes it).
2. In Render, click **New → Web Service** and connect that repo.
3. Set:
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Environment:** Node
4. Under **Environment Variables**, add:
   - `ANTHROPIC_API_KEY` = your real key
   - `ANTHROPIC_MODEL` = `claude-sonnet-5` (or leave unset to use that default)
5. Deploy. Render gives you an `https://your-app.onrender.com` URL with a
   valid TLS certificate automatically — no extra HTTPS setup needed.

### Option B — Any VPS (e.g. a $5 droplet/instance) with Caddy

Caddy gets you free, automatic HTTPS certificates (via Let's Encrypt) with
almost no configuration.

1. Copy the project to the server and run `npm install --production`.
2. Create the `.env` file on the server with your real `ANTHROPIC_API_KEY`
   (never commit it).
3. Run the app persistently, e.g. with `pm2`:
   ```bash
   npm install -g pm2
   pm2 start server.js --name aura
   pm2 save
   ```
4. Point a domain's DNS `A` record at the server's IP.
5. Install Caddy and give it a two-line config (`/etc/caddy/Caddyfile`):
   ```
   your-domain.com {
     reverse_proxy localhost:3000
   }
   ```
6. Restart Caddy (`sudo systemctl restart caddy`). It will automatically
   obtain and renew an HTTPS certificate for `your-domain.com` and proxy
   traffic to the Node app on port 3000.

Other hosts (Railway, Fly.io, a VPS behind Nginx + certbot, etc.) all work
the same way in principle: install dependencies, set `ANTHROPIC_API_KEY` as
an environment variable, run `npm start`, and put it behind HTTPS.

## Environment variables

| Variable            | Required | Purpose                                                        |
|----------------------|----------|------------------------------------------------------------------|
| `ANTHROPIC_API_KEY` | Yes      | Server-side key used to call Claude. Never sent to the browser. |
| `ANTHROPIC_MODEL`   | No       | Overrides the default model (`claude-sonnet-5`).                |
| `PORT`              | No       | Port the server listens on (most hosts set this for you).       |

If `ANTHROPIC_API_KEY` is missing, the server still starts and serves the
UI, but `/api/chat` returns a clear error instead of crashing or silently
failing — you'll see it both in the server logs and as an error bubble in
the app.

## Security notes

- The Anthropic API key exists only in the server process's environment. It
  is never included in any file sent to the browser.
- `/api/chat` is rate-limited (20 requests/minute per IP) to reduce abuse of
  your paid API key, and caps message length and conversation history sent
  upstream.
- The server validates the shape of incoming messages before forwarding
  anything to Anthropic.
- Errors from the backend or network (backend down, API error, offline
  device) are caught and shown to the user as a plain-language message —
  the app never hangs silently.

## About the microphone and HTTPS

Browsers only allow `SpeechRecognition` (and microphone access generally)
on a **secure context** — HTTPS, or `http://localhost` for local dev. The
frontend now detects this (`window.isSecureContext`) and disables the mic
with an explicit banner if the page isn't secure, rather than failing
silently.

That said: **voice input has only been exercised locally during
development, over `localhost`.** It has not yet been verified end-to-end on
a real deployed HTTPS URL on an Android phone (mic permission prompts,
`SpeechRecognition` availability, and background/lock-screen behavior can
vary by device and browser). Once you deploy this and open it on your
phone in Chrome, test:

1. The mic button asks for microphone permission the first time you tap it.
2. Speech is transcribed and appears in the conversation.
3. A reply comes back from `/api/chat` and is read aloud.
4. The Stop Speaking button interrupts playback.

If any of those don't work on your specific device/browser, that's the
next thing to debug — this README doesn't assume it's already confirmed.

## Not included in this version

Reminders, Gmail, Calendar, and WhatsApp integrations are not built. They
appear in Settings as "Planned" and have placeholder entries in the
frontend's `ActionRegistry` (in `public/index.html`) and are intentionally
left unimplemented on the backend, ready to be added as real endpoints
later.
