# Mizan · ميزان

Net-worth and expense tracker built for Egyptian holdings: gold by karat valued at
live EGP spot, multi-currency cash, a liquid-only allocation ribbon, AI quick-add
(text, dictation, receipt photos), budgets, debts, and zakat.

## Run locally

```bash
npm install
npm run dev
```

## Deploy to Vercel

1. Push this folder to a Git repo (GitHub/GitLab/Bitbucket).
2. In Vercel: **Add New → Project → import the repo**. Vercel auto-detects Vite —
   accept the defaults (build command `vite build`, output `dist`). Deploy.

Or without Git: `npm i -g vercel && vercel` from this folder.

No environment variables are needed — the app is fully client-side.

## Install as an app (PWA)

Mizan ships a web app manifest, icons, and a service worker, so once deployed
over HTTPS it's installable:

- **Chrome / Edge desktop:** install icon in the address bar → *Install Mizan*.
- **Android Chrome:** menu (⋮) → *Add to Home screen* → *Install*.
- **iOS Safari:** Share → *Add to Home Screen* (iOS doesn't show an install
  prompt, but the app runs standalone with its own icon).

The service worker precaches the whole app, so the installed app opens and works
offline — your data is local anyway. AI parsing and price lookups still need a
connection. Install prompts require HTTPS (the Vercel URL qualifies; `localhost`
also counts during development, but a plain `http://` LAN address won't).

## AI features (Gemini)

Quick-add parsing, receipt reading, balance sync from screenshots, and the
"today (web)" gold/FX price lookup are AI-powered. On the open web they use the
**Google Gemini API** with your own key:

1. Get a free key at https://aistudio.google.com/apikey
2. In the app: **gear icon → Settings → AI features → paste key → Save** (use
   *Test key* to verify — it reports which model answered).

The model defaults to **auto**: the app asks Google's ListModels API which
Flash models your key supports, uses the newest, and falls back automatically
(flash → flash-lite → older pinned IDs) if Google retires a model ID or a
free-tier quota runs out. Pinning a specific model in Settings keeps the same
safety net.

The key is stored only in your browser's localStorage and sent only to Google's
API. Without a key, AI boxes fall back to a built-in offline parser for simple
notes; typed entries always work.

(When the same `App.jsx` runs inside a Claude.ai artifact, AI calls route to the
auto-authenticated Anthropic endpoint instead and no key is needed.)

## Data & backups

All data lives in your browser (localStorage): accounts, transactions, prices,
net-worth history, and settings. **Settings → Backup & restore** exports
everything as a text blob you can store anywhere and paste back to restore.
Clearing site data clears the app — export first.

## Stack

Vite · React 18 · Tailwind CSS v4 · lucide-react. No backend.
