# Mizan · ميزان

**A net-worth and expense tracker built for Egyptian holdings.**

Mizan tracks gold by karat at live EGP prices, cash in several currencies,
debts, budgets and recurring entries, and works out zakat with a hawl clock.
Logging an expense takes a tap, a share from another app, or a message to a
Telegram bot.

It is local-first: everything works with no account, no network and no
backend. Signing in only adds sync between your devices.

## Features

- **Net worth**: accounts in EGP, other currencies and gold (by karat), valued
  at today's prices, with a liquid-only allocation view and history.
- **Expenses and income**: categories, budgets, targets, debts and recurring
  entries. Each transaction keeps the exchange rate of the day it was logged,
  so changing prices never rewrite past months.
- **Quick add**: type, dictate, or attach a stack of receipt photos and PDFs at
  once. Each receipt is read separately with Gemini, using your own key; a
  built-in offline parser covers typed entries without one.
- **Repeats**: Mizan learns from your own ledger, so `uber` becomes a one-tap
  entry with the usual category, account and amount.
- **Statement sweep**: paste rows, a CSV, a bank PDF or screenshots, and review
  every line at once. Lines that look like ones you already logged are flagged,
  never silently dropped.
- **Share target**: send receipts, invoices or bank SMS to Mizan from any app's
  share sheet (installed PWA on Android and desktop Chromium).
- **Telegram capture** (optional): text the bot `80 uber` or send it a photo,
  and confirm it the next time you open the app.
- **Zakat**: gold and silver nisab from live prices, with a hawl clock.
- **Prices**: gold, silver and USD/EGP from a built-in proxy or public APIs,
  or the local Egyptian gold-market price looked up on the web. You can always
  set prices by hand.
- **Backup and export**: a full `.json` backup plus CSV exports.

## Getting started

```bash
npm install
npm run dev
npm test
```

`npm run dev` serves the app only. That is enough for working on the UI; sync
and the price proxy report themselves unavailable. To run the API locally too,
use `vercel dev`.

**AI features**: get a free key at
[aistudio.google.com/apikey](https://aistudio.google.com/apikey) and paste it
under **Settings → AI features**. The key stays on your device. Mizan picks the
newest Gemini Flash model your key supports and falls back if one is retired or
out of quota.

## Deploying

Import the repository into Vercel. `vercel.json` already declares the build
(`vite build` → `dist`) and the `/api` function, which gives you the full app
and the price proxy. Once deployed over HTTPS, Mizan can be installed as an
app from the browser and works offline.

### Account sync (optional)

Sign in with Google to keep everything in step across devices. Both devices
push their whole document and the server merges it record by record: the
newest edit wins, and deletions carry over instead of being undone. Your
Gemini key and theme are never uploaded.

1. **Database**: Vercel → Storage → Create Database → Neon. This sets
   `DATABASE_URL`, and the table is created on first use.
2. **Auth secret**: run `npx auth secret` and set `AUTH_SECRET`.
3. **Google OAuth**: create a Web OAuth client in Google Cloud Console, set
   `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`, and add the redirect URIs
   `https://<your-project>.vercel.app/api/auth/callback/google` and
   `http://localhost:3000/api/auth/callback/google`.

### Telegram capture (optional)

Needs sync to be set up. Create a bot with @BotFather, set
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` and `TELEGRAM_BOT_USERNAME`, and
register the webhook. Then link your account from **Settings → Telegram
capture**. The server only stores what you send; parsing happens in your
browser with your own key.

[`.env.example`](.env.example) lists every variable with step-by-step notes.
Without them, Mizan hides the features they enable.

## Android app

The same build ships as an Android app wrapped with Capacitor (`android/`). It
keeps everything on the phone: sync and Telegram are off, prices come from the
public rate APIs, and backups go through the share sheet.

Pushing a `v*` tag runs [`.github/workflows/android.yml`](.github/workflows/android.yml),
which tests, builds and attaches a signed `mizan.apk` to the release when the
four `ANDROID_*` signing secrets are set. To build locally (JDK 21 and the
Android SDK):

```bash
npm run build && npx cap sync android
cd android && ./gradlew assembleRelease
```

Set `MIZAN_STORE_FILE`, `MIZAN_STORE_PASSWORD`, `MIZAN_KEY_ALIAS` and
`MIZAN_KEY_PASSWORD` to sign it. Every release must be signed with the same
keystore, or phones have to uninstall (losing their data) to update.

## Your data

Everything lives in your browser unless you sign in. Clearing site data clears
the app, so keep a backup (**Settings → Backup & export**). With a Gemini key,
the text or images you ask it to read are sent to Google.

## Project layout

```
shared/model.js   data model and merge, used by the app and the server
src/lib/          valuation, prices, parsing, PDF reading, zakat, sync, export
src/components/   one file per tab, plus shared parts
src/sw.js         hand-written service worker, including the share target
api/              Vercel function: auth, sync, price proxy, Telegram
android/          Capacitor Android app
test/             node:test suites
docs/             design notes
```

Built with Vite, React 18, Tailwind CSS v4, lucide-react, Auth.js and Neon
Postgres. [`docs/DESIGN.md`](docs/DESIGN.md) explains how the merge, receipt
and PDF reading, repeats, the statement sweep, Telegram capture, prices and
valuation work, and why.
