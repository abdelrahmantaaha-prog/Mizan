/* Statement sweep — catching up a month you never logged.

   The rest of the app is built around logging things as they happen. This is
   for when that did not happen: you skipped three weeks, and the only honest
   record left is the bank's. Feed it a statement — the PDF they emailed,
   pasted text, an exported CSV, or screenshots of the app — and it returns
   every line as a proposed transaction, already categorised, for one pass of
   confirmation. (A PDF is read for its text before it gets here, in
   lib/pdf.js, so the usual case costs one text call rather than a vision call
   per page.)

   The hard part is not reading the statement, it is not logging things twice.
   Whatever you did manage to log by hand is already in the ledger, and it will
   appear in the statement too. So every candidate is checked against what is
   already there and marked, never silently dropped: a bank posts on a
   different day than you spent, and amounts repeat honestly (two 70 EGP rides
   on a Tuesday is a real Tuesday), so this cannot be decided for the user
   without eventually deleting a real expense. Flagged rows come in unticked;
   the decision stays visible and stays theirs. */

import { TAXONOMY } from "../../shared/model.js";
import { applyMemory } from "./memory.js";

/* A bank posts a card payment one to three days after the swipe, so an exact
   date match would flag almost nothing. */
const DUP_DAYS = 3;
const DUP_EPSILON = 0.5; // piastres of rounding between a statement and a typed round number

const stripFences = (s) => s.replace(/```json/gi, "").replace(/```/g, "").replace(/```csv/gi, "");

const dayNum = (iso) => {
  const t = Date.parse((iso || "") + "T00:00:00Z");
  return Number.isFinite(t) ? t / 86400000 : NaN;
};

const amountOf = (t) => (t.type === "income" ? Number(t.toAmount) || 0 : Number(t.fromAmount) || 0);

/* Rows the ledger probably already has. Marks, does not remove. */
export function markDuplicates(candidates, existing, opts = {}) {
  const days = opts.days == null ? DUP_DAYS : opts.days;
  const rows = (existing || []).filter((t) => t && !t.deletedAt);
  const claimed = new Set(); // one ledger row can only explain one statement line

  return (candidates || []).map((c) => {
    const ca = amountOf(c);
    const cd = dayNum(c.date);
    const match = rows.find((t) => {
      if (claimed.has(t.id)) return false;
      if (t.type !== c.type) return false;
      if (Math.abs(amountOf(t) - ca) > DUP_EPSILON) return false;
      const td = dayNum(t.date);
      return Number.isFinite(td) && Number.isFinite(cd) && Math.abs(td - cd) <= days;
    });
    if (!match) return { ...c, dup: null };
    claimed.add(match.id);
    return { ...c, dup: { id: match.id, date: match.date, note: match.note || match.category || "" } };
  });
}

/* ---------- reading the statement ---------- */

const SYSTEM =
  "You read bank, card and wallet statements and return structured transactions. " +
  "You never invent a line that is not in the source, and you never merge two lines into one.";

function buildPrompt(accs, { accountId, hint, today }) {
  const acctList = accs.map((a) => ({ id: a.id, name: a.name, unit: a.unit, class: a.assetClass, liability: !!a.isLiability }));
  const acct = accountId ? accs.find((a) => a.id === accountId) : null;

  return (
    `Today is ${today}. The input is a bank/card/wallet statement — pasted text, CSV, or a screenshot of a transaction list. ` +
    "Return EVERY transaction line it contains, one object per line, oldest first. " +
    (acct
      ? `This statement belongs to account id "${acct.id}" (${acct.name}): use it as fromId for every debit and toId for every credit. `
      : `Their accounts as JSON: ${JSON.stringify(acctList)}. Pick the account the statement belongs to and use it consistently. `) +
    "Reply with ONLY a JSON ARRAY, no prose, no fences. Each element: " +
    '{"type":"expense|income|transfer","fromId":<id or null>,"toId":<id or null>,"fromAmount":<number>,"toAmount":<number or null>,"category":"<main>","subcategory":"<sub>","date":"YYYY-MM-DD","note":"<merchant as printed>"}. ' +
    `Prefer this category -> subcategory taxonomy, adding one only if nothing fits: ${JSON.stringify(TAXONOMY)}. ` +
    "A debit / withdrawal / purchase is an expense (fromId set, toId null, fromAmount = the amount). " +
    "A credit / deposit / salary is income (toId set, fromId null, toAmount = the amount). " +
    "A payment to the person's OWN other account, a card bill payment, or a savings/investment move is a transfer — set both ids if you can identify the other account, otherwise treat it as an expense with category Investment or Bills. " +
    "Keep the merchant name in `note` exactly as printed — it is what the person will recognise. " +
    "Dates: use the transaction date, not the posting date, when both are shown. Expand a short date like '12 Aug' using the statement's own period; never guess a year outside it. " +
    "Amounts: strip thousands separators and currency symbols. If a line shows a running balance as well as an amount, the amount is the smaller changing number — never return the balance. " +
    "SKIP: opening/closing balance rows, subtotals, 'total' rows, interest summaries, and any line with no amount. " +
    "If the input is not a statement at all, reply with []." +
    (hint ? `\n\nThe person adds: "${hint}"` : "")
  );
}

function normalizeRow(accs, p, today, fallbackAcct) {
  const byId = (id) => accs.find((a) => a.id === id);
  const resolve = (v) => {
    if (!v) return null;
    if (byId(v)) return v;
    const hit = accs.find((a) => a.name.toLowerCase().includes(String(v).toLowerCase()));
    return hit ? hit.id : null;
  };
  const type = ["expense", "income", "transfer"].includes(p.type) ? p.type : "expense";
  const fa = Math.abs(Number(p.fromAmount) || 0);
  const ta = p.toAmount != null ? Math.abs(Number(p.toAmount)) : undefined;
  return {
    type,
    fromId: type === "income" ? null : resolve(p.fromId) || fallbackAcct || accs[0]?.id,
    toId: type === "expense" ? null : resolve(p.toId) || fallbackAcct || accs[0]?.id,
    fromAmount: type === "income" ? 0 : fa || ta || 0,
    toAmount: type === "income" ? ta || fa || 0 : ta,
    category: (p.category || "").toString().slice(0, 30),
    subcategory: (p.subcategory || "").toString().slice(0, 30),
    date: /^\d{4}-\d{2}-\d{2}$/.test(p.date || "") ? p.date : today,
    note: (p.note || "").toString().slice(0, 80),
  };
}

/* One page of a statement: { text } and/or { image } and/or { files } — the
   last being pages of a PDF that had no text to extract, sent as the file
   itself. A page carrying characters spends no vision call at all, which is
   why a text PDF is turned into { text } before it ever gets here. */
export async function parseStatementPage(accs, { text, image, files, accountId, memory }, ai) {
  const today = new Date().toISOString().slice(0, 10);
  const atts = [image, ...(files || [])].filter(Boolean);
  const prompt =
    buildPrompt(accs, { accountId, hint: atts.length ? text : null, today }) +
    (atts.length ? "" : `\n\nStatement:\n${String(text || "").slice(0, 24000)}`);

  const out = await ai({ prompt, system: SYSTEM, files: atts.length ? atts : undefined });
  const cleaned = stripFences(out);
  const m = cleaned.match(/\[[\s\S]*\]/);
  if (!m) throw new Error("no-json");
  let raw = JSON.parse(m[0]);
  if (!Array.isArray(raw)) raw = [raw];

  const exists = (id) => accs.some((a) => a.id === id);
  return raw
    .map((p) => normalizeRow(accs, p, today, accountId))
    .map((t) => (memory ? applyMemory(memory, t, { accountExists: exists }) : t))
    .filter((t) => t.fromAmount || t.toAmount);
}

/* A whole statement: any number of pasted blocks and screenshots.

   Pages are read one at a time rather than in parallel — a statement is a
   dozen images at worst, and the free Gemini tier answers a burst of parallel
   vision calls with 429s, which would fail the sweep for no gain in a flow
   the user is already waiting on. A page that fails is reported rather than
   silently dropping its rows. */
export async function parseStatement(accs, { pages, accountId, memory }, ai, onProgress) {
  const list = (pages || []).filter((p) => p && (p.text || p.image || (p.files && p.files.length)));
  if (!list.length) throw new Error("empty-input");

  const rows = [];
  const failed = [];
  for (let i = 0; i < list.length; i++) {
    if (onProgress) onProgress({ page: i + 1, of: list.length });
    try {
      const got = await parseStatementPage(accs, { ...list[i], accountId, memory }, ai);
      rows.push(...got);
    } catch (e) {
      failed.push({ page: i + 1, error: (e && e.message) || "failed" });
    }
  }
  if (!rows.length && failed.length) throw new Error("all-pages-failed");

  rows.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  return { rows, failed };
}

/* ---------- CSV ----------
   Handing raw CSV to the model works, but a 400-row export is a lot of tokens
   to spend on something with a header row telling you exactly where the date
   and the amount are. This trims it to the columns that matter first; the
   model still does the categorising. */
export function trimCsv(text, maxRows = 400) {
  const lines = String(text || "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length <= 1) return String(text || "");
  return lines.slice(0, maxRows + 1).join("\n");
}
