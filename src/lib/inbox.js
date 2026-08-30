/* Client half of Telegram capture.

   The server holds whatever the bot was sent; this drains it. Parsing happens
   here, in the browser, with the user's own key — the server has no AI
   credential on purpose (see api/_inbox.js).

   Draining is a two-step: read the items, turn them into proposed
   transactions, and only then acknowledge. Acknowledging first would be
   simpler and would lose a receipt whenever a parse failed or the tab was
   closed mid-read, and a capture the user was told was "saved" must not be
   able to evaporate. Items therefore stay on the server until the app has
   something to show for them. */

import { readAttachment } from "./files.js";

const API = {
  inbox: "/api/inbox",
  ack: "/api/inbox/ack",
  link: "/api/inbox/link",
};

const NONE = { items: [], available: false };

export async function fetchInbox() {
  try {
    const r = await fetch(API.inbox, { credentials: "same-origin", headers: { Accept: "application/json" } });
    if (!r.ok) return NONE; // 401 signed out, 503 unconfigured — both mean "nothing to show"
    const j = await r.json();
    return { items: Array.isArray(j.items) ? j.items : [], available: !!j.available };
  } catch {
    return NONE;
  }
}

/* A captured file — a photo, or a PDF invoice forwarded to the bot — read the
   same way a picked one is, so a PDF with a text layer costs no vision call
   here either. */
export async function fetchInboxFile(id) {
  const r = await fetch(`${API.inbox}/${encodeURIComponent(id)}/file`, { credentials: "same-origin" });
  if (!r.ok) throw new Error("file-" + r.status);
  const blob = await r.blob();
  const type = blob.type || "image/jpeg";
  const name = "telegram-" + id + (/pdf/.test(type) ? ".pdf" : "");
  return readAttachment(new File([blob], name, { type }));
}

export async function ackInbox(ids) {
  if (!ids || !ids.length) return 0;
  try {
    const r = await fetch(API.ack, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    if (!r.ok) return 0;
    const j = await r.json();
    return j.removed || 0;
  } catch {
    return 0;
  }
}

export async function createLink() {
  const r = await fetch(API.link, { method: "POST", credentials: "same-origin" });
  if (!r.ok) throw new Error("link-" + r.status);
  return r.json();
}

export async function unlinkTelegram() {
  const r = await fetch(API.link, { method: "DELETE", credentials: "same-origin" });
  if (!r.ok) throw new Error("unlink-" + r.status);
  return r.json();
}

/* Turn captured items into proposed transactions.

   Each item is read independently: one unreadable receipt should cost its own
   row and nothing else, and an item whose parse fails is left on the server so
   it can be retried rather than vanishing. Returns the proposals plus the ids
   that are safe to acknowledge. */
export async function drainInbox(items, { parseText, parseFile, loadFile }, onProgress) {
  const proposals = [];
  const doneIds = [];
  const failed = [];

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (onProgress) onProgress({ done: i, of: items.length });
    try {
      let rows;
      if (it.hasFile) {
        const attachment = await loadFile(it.id);
        rows = await parseFile(attachment, it.text || "");
      } else {
        rows = await parseText(it.text || "");
      }
      const list = (Array.isArray(rows) ? rows : [rows]).filter(Boolean);
      if (!list.length) throw new Error("empty");
      proposals.push(...list.map((r) => ({ ...r, _from: "telegram", _itemId: it.id })));
      doneIds.push(it.id);
    } catch (e) {
      failed.push({ id: it.id, text: it.text, error: (e && e.message) || "failed" });
    }
  }
  if (onProgress) onProgress({ done: items.length, of: items.length });
  return { proposals, doneIds, failed };
}
