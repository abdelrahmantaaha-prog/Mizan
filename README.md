# Mizan · ميزان

Net-worth and expense tracker built for Egyptian holdings: gold by karat valued
at live EGP spot, multi-currency cash, a liquid-only allocation ribbon, AI
quick-add (text, dictation, receipt photos), budgets, debts, recurring entries,
and zakat with a hawl clock.

Local-first. Everything works with no account, no network and no backend —
signing in only adds sync across your devices.

## Run locally

```bash
npm install
npm run dev
```

```bash
npm test
```

The tests cover the parts where a silent bug costs real data: document merge,
migration, the sync push path, transaction valuation, and zakat.

## Deploy to Vercel

1. Push this folder to a Git repo.
2. In Vercel: **Add New → Project → import the repo**. `vercel.json` already
   declares the build (`vite build` → `dist`) and the `/api` function.

That gets you the full app plus the price proxy. Account sync additionally
needs the environment variables below; without them the app runs local-only and
says so in Settings rather than showing a broken sign-in button.

## Account sync (optional)

Sign in with Google and Mizan keeps accounts, transactions, debts, budgets,
targets and history in step across devices.

**How conflicts are handled.** Both devices push their whole document; the
server merges it record by record, newest edit wins, and deletes are
tombstoned so they propagate instead of being undone by the other device's
copy. Logging an expense on your phone while editing an account on your laptop
keeps both. The merge is symmetric and idempotent, so re-syncing never
degrades — the same logic runs on the client and the server, from
[`shared/model.js`](shared/model.js).

**What is never uploaded:** your Gemini API key and your theme. They stay on
the device.

### Setup

1. **Database** — Vercel dashboard → **Storage → Create Database → Neon**. The
   integration injects `DATABASE_URL`. The table is created on first use.
2. **Auth secret** — `npx auth secret`, then set `AUTH_SECRET`.
3. **Google OAuth** — Google Cloud Console → *APIs & Services → Credentials →
   Create credentials → OAuth client ID → Web application*. Set
   `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`, and add these authorised redirect
   URIs:

   ```
   https://<your-project>.vercel.app/api/auth/callback/google
   http://localhost:3000/api/auth/callback/google
   ```

See [`.env.example`](.env.example) for the full list.

Running the API locally needs `vercel dev` (plain `vite dev` serves the
frontend only, which is a supported way to work on the UI — sync simply reports
itself unavailable).

## Install as an app (PWA)

Mizan ships a manifest, icons and a service worker, so once deployed over HTTPS
it's installable:

- **Chrome / Edge desktop:** install icon in the address bar → *Install Mizan*.
- **Android Chrome:** menu (⋮) → *Add to Home screen*.
- **iOS Safari:** Share → *Add to Home Screen*.

The app precaches itself and opens offline. A new build announces itself with a
*New version ready* prompt instead of reloading underneath you; API calls are
never served from cache.

## AI features (Gemini)

Quick-add parsing, receipt reading, balance sync from screenshots and the
"today (web)" price lookup are AI-powered, using **your own** Google Gemini key:

1. Get a free key at https://aistudio.google.com/apikey
2. **Settings → AI features → paste key → Save** (*Test key* reports which
   model answered).

The model defaults to **auto**: the app asks Google's ListModels API which Flash
models your key supports, uses the newest, and falls back automatically if
Google retires an ID or a free-tier quota runs out.

Without a key, AI boxes fall back to a built-in offline parser; typed entries
always work. (Inside a Claude.ai artifact, calls route to the auto-authenticated
Anthropic endpoint and no key is needed.)

## Prices

Three routes, cheapest first:

1. **`/api/prices`** — this deployment's own endpoint. Fetches server-side, so
   browser CORS never blocks it, and returns gold, **silver** (for the silver
   zakat nisab) and USD/EGP.
2. **Public APIs direct from the browser** — the fallback when there's no
   backend.
3. **AI with search grounding** — the *today (web)* button. The only route that
   reads the Egyptian local صاغة price rather than deriving it from global spot.

Every karat rescales from the 24K number, and you can always set prices by hand.

## A note on how amounts are valued

An account **balance** is worth what today's price says — that's the point of a
live net-worth figure. A **transaction** records the EGP rate that applied when
it was logged, and all spending analysis reads that snapshot. Without this, a
refreshed gold or FX price quietly rewrites past months: a $100 dinner from last
year grows every time the pound weakens, and "what I spent in March" is a
different number depending on when you ask.

## Data & backups

Everything lives in your browser unless you sign in. **Settings → Backup &
export** downloads a `.json` backup (accounts, transactions, debts, budgets,
targets, history) plus CSV exports of transactions and accounts for a
spreadsheet. Clearing site data clears the app — keep a backup.

## Stack

Vite · React 18 · Tailwind CSS v4 · lucide-react · Auth.js (`@auth/express`) ·
Neon Postgres · Vercel.

```
shared/model.js        data model + merge — imported by both app and server
src/lib/               valuation, prices, parsing, zakat, sync, export
src/components/        one file per tab, plus shared primitives
api/                   the Vercel function: auth, sync, price proxy
test/                  node:test, no runner needed
```
