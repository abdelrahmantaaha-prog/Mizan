/* Telegram capture — the inbox, and the bot that fills it.

   The point of this route is that it works when the app is not open and the
   phone is not yours to unlock properly: you are standing at a till, you type
   "80 uber" into a chat you already have pinned, and it is captured. Mizan
   turns it into a transaction later, on your terms.

   What this deliberately does NOT do is parse. No AI key lives on this server:
   Mizan's whole key story is that the key sits in the browser and goes only to
   Google, and putting a second copy in a Vercel environment variable to save
   the user one tap would quietly undo that. So the bot stores exactly what was
   sent — text, or a photo's file id — and the app parses it with its own key
   when it next opens. The bot's reply says "saved", not "logged", because
   that is the truth: nothing reaches your balances without you seeing it,
   which is the same promise recurring.js and the sweep make.

   Photos stay on Telegram's servers and are fetched through a proxy route when
   the app asks for them, so the database never holds image bytes. */

import { neon } from "@neondatabase/serverless";
import { webcrypto } from "node:crypto";

const TG_API = "https://api.telegram.org";

/* Items expire. An inbox is a waiting room, not a second ledger — something
   sent two months ago and never confirmed is noise the user has to clear
   before they can trust the queue. */
export const ITEM_TTL_DAYS = 30;
const CODE_TTL_MINUTES = 15;
const MAX_ITEMS_PER_USER = 200;
const MAX_TEXT = 2000;

let sql = null;
let schemaReady = null;

export function botToken() {
  return (process.env.TELEGRAM_BOT_TOKEN || "").trim();
}
export function botUsername() {
  return (process.env.TELEGRAM_BOT_USERNAME || "").trim().replace(/^@/, "");
}
export function webhookSecret() {
  return (process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
}
export function isConfigured() {
  return !!(process.env.DATABASE_URL && botToken() && webhookSecret());
}

function client() {
  if (!process.env.DATABASE_URL) {
    const e = new Error("DATABASE_URL is not set");
    e.status = 503;
    e.code = "db-unconfigured";
    throw e;
  }
  if (!sql) sql = neon(process.env.DATABASE_URL);
  return sql;
}

async function ensureSchema() {
  if (schemaReady) return schemaReady;
  const db = client();
  schemaReady = (async () => {
    await db`
      CREATE TABLE IF NOT EXISTS mizan_tg_chat (
        chat_id   text PRIMARY KEY,
        user_id   text NOT NULL,
        linked_at timestamptz NOT NULL DEFAULT now()
      )`;
    await db`CREATE INDEX IF NOT EXISTS mizan_tg_chat_user_idx ON mizan_tg_chat (user_id)`;
    await db`
      CREATE TABLE IF NOT EXISTS mizan_tg_code (
        code       text PRIMARY KEY,
        user_id    text NOT NULL,
        expires_at timestamptz NOT NULL
      )`;
    await db`
      CREATE TABLE IF NOT EXISTS mizan_inbox (
        id         bigserial PRIMARY KEY,
        user_id    text NOT NULL,
        kind       text NOT NULL,
        body       text,
        file_id    text,
        created_at timestamptz NOT NULL DEFAULT now()
      )`;
    await db`CREATE INDEX IF NOT EXISTS mizan_inbox_user_idx ON mizan_inbox (user_id, created_at DESC)`;
  })().catch((e) => {
    schemaReady = null;
    throw e;
  });
  return schemaReady;
}

/* ---------- linking ----------
   A short code, redeemed by sending /start <code> to the bot. The code is the
   only thing that ever crosses between the two worlds, it dies in fifteen
   minutes, and it is single-use — a leaked one is a leaked one, but it cannot
   be sat on. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I/L/O/0/1 to read aloud

export function newCode(len = 8) {
  const bytes = new Uint8Array(len);
  (globalThis.crypto || webcrypto).getRandomValues(bytes);
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
}

export async function createLinkCode(userId) {
  await ensureSchema();
  const db = client();
  const code = newCode();
  await db`DELETE FROM mizan_tg_code WHERE user_id = ${userId} OR expires_at < now()`;
  await db`
    INSERT INTO mizan_tg_code (code, user_id, expires_at)
    VALUES (${code}, ${userId}, now() + ${CODE_TTL_MINUTES + " minutes"}::interval)`;
  return { code, expiresInMinutes: CODE_TTL_MINUTES, bot: botUsername() };
}

/* Redeem and bind. Returns the user id, or null when the code is unknown or
   expired. A chat can only ever point at one account; re-linking replaces. */
export async function redeemLinkCode(code, chatId) {
  await ensureSchema();
  const db = client();
  const rows = await db`
    DELETE FROM mizan_tg_code
     WHERE code = ${String(code).toUpperCase()} AND expires_at > now()
    RETURNING user_id`;
  if (!rows.length) return null;
  const userId = rows[0].user_id;
  await db`
    INSERT INTO mizan_tg_chat (chat_id, user_id) VALUES (${String(chatId)}, ${userId})
    ON CONFLICT (chat_id) DO UPDATE SET user_id = EXCLUDED.user_id, linked_at = now()`;
  return userId;
}

export async function userForChat(chatId) {
  await ensureSchema();
  const db = client();
  const rows = await db`SELECT user_id FROM mizan_tg_chat WHERE chat_id = ${String(chatId)}`;
  return rows.length ? rows[0].user_id : null;
}

export async function chatsForUser(userId) {
  await ensureSchema();
  const db = client();
  const rows = await db`SELECT chat_id, linked_at FROM mizan_tg_chat WHERE user_id = ${userId}`;
  return rows.map((r) => ({ chatId: r.chat_id, linkedAt: r.linked_at }));
}

export async function unlinkUser(userId) {
  await ensureSchema();
  const db = client();
  await db`DELETE FROM mizan_tg_chat WHERE user_id = ${userId}`;
  await db`DELETE FROM mizan_tg_code WHERE user_id = ${userId}`;
}

/* ---------- the inbox ---------- */
export async function addItem(userId, { kind, body, fileId }) {
  await ensureSchema();
  const db = client();
  await db`DELETE FROM mizan_inbox WHERE created_at < now() - ${ITEM_TTL_DAYS + " days"}::interval`;
  const count = await db`SELECT count(*)::int AS n FROM mizan_inbox WHERE user_id = ${userId}`;
  if (count[0].n >= MAX_ITEMS_PER_USER) {
    const e = new Error("inbox-full");
    e.code = "inbox-full";
    e.status = 429;
    throw e;
  }
  const rows = await db`
    INSERT INTO mizan_inbox (user_id, kind, body, file_id)
    VALUES (${userId}, ${kind}, ${body ? String(body).slice(0, MAX_TEXT) : null}, ${fileId || null})
    RETURNING id, created_at`;
  return { id: Number(rows[0].id), createdAt: rows[0].created_at };
}

export async function listItems(userId) {
  await ensureSchema();
  const db = client();
  const rows = await db`
    SELECT id, kind, body, (file_id IS NOT NULL) AS has_file, created_at
      FROM mizan_inbox
     WHERE user_id = ${userId} AND created_at > now() - ${ITEM_TTL_DAYS + " days"}::interval
     ORDER BY created_at ASC`;
  return rows.map((r) => ({
    id: Number(r.id),
    kind: r.kind,
    text: r.body || "",
    hasFile: !!r.has_file,
    createdAt: r.created_at,
  }));
}

export async function getItemFileId(userId, id) {
  await ensureSchema();
  const db = client();
  const rows = await db`SELECT file_id FROM mizan_inbox WHERE user_id = ${userId} AND id = ${Number(id)}`;
  return rows.length ? rows[0].file_id : null;
}

/* Acknowledge: the app has taken these and they are its problem now. */
export async function deleteItems(userId, ids) {
  await ensureSchema();
  const db = client();
  const list = (ids || []).map(Number).filter(Number.isFinite).slice(0, 500);
  if (!list.length) return 0;
  const rows = await db`DELETE FROM mizan_inbox WHERE user_id = ${userId} AND id = ANY(${list}) RETURNING id`;
  return rows.length;
}

/* ---------- Telegram calls ---------- */
async function tg(method, payload) {
  const res = await fetch(`${TG_API}/bot${botToken()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function reply(chatId, text) {
  try {
    await tg("sendMessage", { chat_id: chatId, text, disable_notification: true });
  } catch {
    // a failed courtesy reply must not fail the capture that preceded it
  }
}

/* Photo bytes, fetched on demand so the database never stores an image. */
export async function fetchFile(fileId) {
  const meta = await tg("getFile", { file_id: fileId });
  const path = meta && meta.ok && meta.result && meta.result.file_path;
  if (!path) throw Object.assign(new Error("file-gone"), { status: 404, code: "file-gone" });
  const res = await fetch(`${TG_API}/file/bot${botToken()}/${path}`);
  if (!res.ok) throw Object.assign(new Error("file-fetch-failed"), { status: 502, code: "file-fetch-failed" });
  const buf = Buffer.from(await res.arrayBuffer());
  const type = /\.pdf$/i.test(path)
    ? "application/pdf"
    : /\.png$/i.test(path)
    ? "image/png"
    : /\.webp$/i.test(path)
    ? "image/webp"
    : "image/jpeg";
  return { buf, type };
}

/* ---------- webhook body ----------
   Pulled out of the route so the shapes Telegram sends can be tested without
   HTTP: a plain message, a photo with a caption, an image sent as a document,
   and the /start that links the chat. */
export function readUpdate(update) {
  const msg = (update && (update.message || update.edited_message || update.channel_post)) || null;
  if (!msg || !msg.chat) return null;

  const chatId = String(msg.chat.id);
  const text = String(msg.text || msg.caption || "").trim();

  const start = /^\/start(?:@\S+)?(?:\s+(\S+))?/.exec(text);
  if (start) return { chatId, kind: "start", code: start[1] || "" };
  if (/^\/(help|status)(?:@\S+)?/.test(text)) return { chatId, kind: "help" };
  if (/^\/stop(?:@\S+)?/.test(text)) return { chatId, kind: "stop" };

  // photos arrive as a ladder of sizes, largest last
  if (Array.isArray(msg.photo) && msg.photo.length) {
    const best = msg.photo[msg.photo.length - 1];
    return { chatId, kind: "photo", fileId: best.file_id, text };
  }
  /* An image sent as a document keeps its full resolution, and a PDF — the
     invoice a merchant emailed, forwarded straight to the bot — is read by
     the same models the app already sends photos to, so both are just a file
     waiting to be parsed with the user's own key. */
  if (msg.document && /^(image\/|application\/pdf$)/.test(msg.document.mime_type || "")) {
    return { chatId, kind: "photo", fileId: msg.document.file_id, text };
  }
  if (text) return { chatId, kind: "text", text };
  return { chatId, kind: "ignored" };
}
