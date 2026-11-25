# How Mizan works

Design notes: what each part does, and why it was built that way. For
installing and deploying Mizan, see the [README](../README.md).

## Sync

**How conflicts are handled.** Both devices push their whole document; the
server merges it record by record, newest edit wins, and deletes are
tombstoned so they propagate instead of being undone by the other device's
copy. Logging an expense on your phone while editing an account on your laptop
keeps both. The merge is symmetric and idempotent, so re-syncing never
degrades — the same logic runs on the client and the server, from
[`shared/model.js`](../shared/model.js).

**What is never uploaded:** your Gemini API key and your theme. They stay on
the device.

## The share target

Installed, Mizan also registers as a **share target**: receipt photos, a PDF
invoice, an Instapay confirmation or a bank SMS can be sent to it from any app's
share sheet — several at once — and it opens straight into quick-add with the
parse already running. The share arrives as a `POST` that
[`src/sw.js`](../src/sw.js) answers — which is why the service worker is
hand-written rather than generated. (Android/desktop Chromium; iOS Safari has
no share-target API.)

## The Android build

What is different inside the APK, all of it gated on `isNative()` in
[`src/lib/native.js`](../src/lib/native.js) so the web app is untouched:

- **Everything stays on the phone.** There is no `/api` behind the app, so
  account sync and Telegram capture are off, and prices come straight from the
  public rate APIs. Move data with *Settings → Backup* and *Restore*.
- **Backups and CSVs go through the share sheet** (a blob download does
  nothing in an Android WebView) — save them to Drive, Files, or anywhere.
- **Back** closes the open dialog, then Settings, then returns to Overview, and
  only from Overview leaves the app.
- No service worker: the APK carries its files and updates by installing a new
  APK. The share target is a PWA feature and is not in the APK yet.

## Logging without opening the app

Four routes in, ordered by how little they ask of you:

| Route | What it costs you |
| --- | --- |
| **Repeat** — type `uber`, tap *Log now* | one tap; no network, no model |
| **Share sheet** — send a receipt to Mizan from anywhere | one share |
| **Telegram** — text the bot, confirm later | one message, whenever |
| **Statement sweep** — paste or screenshot a statement | one pass a month |

**Repeats** come from [`src/lib/memory.js`](../src/lib/memory.js), which indexes
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
([`src/lib/pdf.js`](../src/lib/pdf.js), no library — inflate plus a content-stream
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

## Telegram capture

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

## AI features

Quick-add parsing, receipt reading, balance sync from screenshots and the
"today (web)" price lookup are AI-powered, using **your own** Google Gemini key, set under **Settings → AI features**.

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
