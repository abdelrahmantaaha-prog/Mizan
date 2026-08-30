# Mizan · ميزان

Net-worth and expense tracker built for Egyptian holdings: gold by karat valued
at live EGP spot, multi-currency cash, a liquid-only allocation ribbon, AI
quick-add (text, dictation, a stack of receipt photos and PDFs at once),
budgets, debts, recurring entries, and zakat with a hawl clock.

Logging is meant to survive not feeling like logging: one-tap repeats learned
from your own ledger, a system share target, a Telegram bot for when the app
isn't open, and a statement sweep for the weeks you skipped entirely.

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
migration, the sync push path, transaction valuation, zakat, and the PDF reader
— which has to refuse a file it cannot honestly read rather than hand back
plausible nonsense.

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

Installed, Mizan also registers as a **share target**: receipt photos, a PDF
invoice, an Instapay confirmation or a bank SMS can be sent to it from any app's
share sheet — several at once — and it opens straight into quick-add with the
parse already running. The share arrives as a `POST` that
[`src/sw.js`](src/sw.js) answers — which is why the service worker is
hand-written rather than generated. (Android/desktop Chromium; iOS Safari has
no share-target API.)

## Logging without opening the app

Four routes in, ordered by how little they ask of you:

| Route | What it costs you |
| --- | --- |
| **Repeat** — type `uber`, tap *Log now* | one tap; no network, no model |
| **Share sheet** — send a receipt to Mizan from anywhere | one share |
| **Telegram** — text the bot, confirm later | one message, whenever |
| **Statement sweep** — paste or screenshot a statement | one pass a month |

**Repeats** come from [`src/lib/memory.js`](src/lib/memory.js), which indexes
your own ledger by the words in its notes: category, subcategory, the account
that usually pays, and the median amount. Recency is weighted with a 90-day
half-life, so switching from cash to a card changes the answer in a few uses
rather than being outvoted by a year of history. A word split evenly between
two meanings answers nothing at all. It also backs the offline parser, so a
missing key stops being a downgrade on anything you log often.

**The statement sweep** reads the PDF your bank emailed, pasted rows, CSV
exports or screenshots of a banking app, and proposes every line at once. Lines
that match something already in the ledger (same type, same amount, within
three days) arrive **flagged and unticked, never removed** — a bank posts on a
different day than you spent, and two 70 EGP rides on one Tuesday is a real
Tuesday.

## Receipts and PDFs

Quick add takes a stack, not a file: pick the evening's four receipts and the
PDF the restaurant emailed, and each is read **on its own call**, so every
receipt keeps its own store, its own date and its own total. Sending them
together is what makes three totals come back as one number nobody recognises.
Pages of a single long invoice are the other case, and there is a checkbox for
it — off by default, because separate receipts are what people actually have.

**A PDF is routed, not converted.** Mizan opens it in the browser first
([`src/lib/pdf.js`](src/lib/pdf.js), no library — inflate plus a content-stream
tokenizer) and tries to recover the text:

| what the PDF is | what happens |
| --- | --- |
| an e-statement or invoice with a text layer | the text is pulled out here; **no vision call at all**, twelve pages cost one small text request, and the offline parser can read it |
| a scan, or password-protected | the file itself goes to the model, which reads the pages |
| Arabic | the file goes to the model — see below |

Text in a PDF is positioned rather than flowed, so the reader rebuilds rows
from where each run is drawn, and follows each font's ToUnicode table to turn
glyph numbers back into characters — without that, everything printed from a
browser in the last decade decodes to fluent-looking nonsense.

Which is the danger the whole thing is shaped around: a wrong reading does not
announce itself, it just quietly writes invented rows into a ledger. So
extraction has to *prove* it worked — the output has to be overwhelmingly
printable, have numbers and real words in it — and anything short of that is
reported unreadable and sent to the model instead. Arabic is refused for the
same reason: PDFs usually store it in the order it is drawn, right to left, and
nothing in the file says whether this one did, so a merchant name could arrive
spelled backwards. The model reads those pages as they look.

The badge under each attachment says which path it took.

## Telegram capture (optional)

Text the bot `80 uber`, or send it a photo of a receipt or a forwarded PDF
invoice, and it waits for you. Next time you open Mizan, *N waiting from
Telegram* appears in Activity, and one tap reads them into the same review list
everything else goes through.

**The server never parses.** It stores exactly what was sent — text, or a
photo's Telegram file id — and the browser does the reading with your own key.
Putting a second copy of the key in a server environment variable to save one
tap would quietly undo the thing the key story is for. Photos stay on
Telegram's servers and are proxied on demand, so the database holds no image
bytes.

Linking uses a single-use code from **Settings → Telegram capture**, sent to
the bot as `/start <code>`; it expires in 15 minutes. `/stop` unlinks, and
captures are dropped after 30 days if never confirmed.

Setup is three environment variables and one `setWebhook` call — see
[`.env.example`](.env.example). Without them the app hides the feature rather
than showing a button that cannot work.

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
src/lib/pdf.js         PDF text extraction, no dependency
src/lib/files.js       one shape for anything picked, shared or dropped in
src/components/        one file per tab, plus shared primitives
api/                   the Vercel function: auth, sync, price proxy
test/                  node:test, no runner needed
```
