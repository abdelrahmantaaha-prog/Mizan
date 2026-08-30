/* Turning notes, dictation and receipt photos into transactions.

   Two parsers live here: the AI one, and a deliberately dumb offline
   heuristic. The offline path exists because a finance app that refuses to
   record a coffee because a model was unreachable is worse than one that
   records it roughly and asks you to check.

   Both consult merchant memory (memory.js) — your own ledger, indexed by the
   words in its notes. It only ever fills a blank: the model's answer and
   anything you typed outrank it, so memory sharpens the guess without ever
   quietly contradicting a stated one. */

import { TAXONOMY } from "../../shared/model.js";
import { applyMemory, recall } from "./memory.js";

export function withTimeout(p, ms) {
  let t;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise((_, rej) => { t = setTimeout(() => rej(new Error("timeout")), ms); }),
  ]);
}

const stripFences = (s) => s.replace(/```json/gi, "").replace(/```/g, "");

/* ---------- transactions ----------

   `image` is one attachment, `files` several, `docText` the characters of
   something already readable without a model — a PDF whose text layer came
   out clean, or a CSV. When several files are passed they are treated as one
   document (an invoice over three pages, a receipt photographed in halves);
   several *separate* receipts go through parseReceipts below, one call each,
   because merging them into one call is how a line gets counted twice. */
export async function parseEntry(accs, { text, image, files, docText, payFrom, memory }, ai) {
  const today = new Date().toISOString().slice(0, 10);
  const atts = [image, ...(files || [])].filter(Boolean);
  const acctList = accs.map((a) => ({ id: a.id, name: a.name, unit: a.unit, class: a.assetClass, liability: !!a.isLiability }));
  const payLine = payFrom
    ? `The paying account is id "${payFrom}" — use it as fromId for every expense. `
    : "For an unclear expense use the most likely cash account. ";
  const instructions =
    `Today is ${today}. Turn the person's quick note (and/or receipt image) into transactions for their finance app. ` +
    "The note may describe SEVERAL transactions — split them. " +
    `Their accounts as JSON: ${JSON.stringify(acctList)}. ` +
    "Reply with ONLY a JSON ARRAY (even if there is just one), no prose, no fences. Each element shape: " +
    '{"type":"expense|income|transfer","fromId":<account id or null>,"toId":<account id or null>,"fromAmount":<number>,"toAmount":<number or null>,"category":"<main category>","subcategory":"<sub>","date":"YYYY-MM-DD","note":"<short>"}. ' +
    `Prefer this category -> subcategory taxonomy, but you may add new ones if nothing fits: ${JSON.stringify(TAXONOMY)}. ` +
    "category is the main bucket; subcategory is the specific one under it (may be empty). " +
    "RECEIPTS / ORDERS: a grocery or delivery order is NOT automatically all Food — classify EVERY line item on its own merits, and NEVER file a non-food item under Food. " +
    "Non-food items and where they go: garbage/trash bags (اكياس قمامة / اكياس زبالة), tissues and wet wipes (مناديل / مناديل مبللة / محارم), foil and cling film (قصدير / ورق فويل), cleaning products and detergent (منظفات / مسحوق غسيل / كلور), dish soap, soap/shampoo/toothpaste (صابون / شامبو / معجون أسنان) → Housing/Household (toiletries may be Personal, baby items Family); batteries/bulbs → Housing/Household; medicine (دواء) → Health. Actual food and drink → Food/Groceries. " +
    "If even one non-food item is present you MUST return at least two transactions (one per category). " +
    "Output ONE expense per category, fromAmount = the summed price of that category's items, allocating any coupon/discount/service fee/tip proportionally across categories so the per-category totals add up to the amount actually charged (the order total, not the subtotal). " +
    "All lines from the same receipt share the same fromId and the same note ('<store/app>, <date>'); use the receipt's date if visible. Do not output a line that is just the grand total. " +
    "Rules: expense = money leaving (set fromId, toId null, fromAmount = amount spent). " +
    "income = money arriving (set toId, fromId null, toAmount = amount). " +
    "transfer/buy = both accounts; fromAmount is in the FROM account's unit and toAmount in the TO account's unit. " +
    payLine +
    "Use today's date unless the note or receipt says otherwise.";

  let prompt = instructions;
  if (atts.length > 1)
    prompt +=
      ` The ${atts.length} attached pages are ONE document — pages of the same receipt, invoice or order. ` +
      "Read them together and never count the same line twice; a total that appears on more than one page is still one total.";
  else if (atts.length === 1 && !text) prompt += " The attachment is a receipt — split its items into per-category transactions.";
  if (docText) prompt += `\n\nAttached document (already text, read it as the receipt/invoice):\n${docText.slice(0, 24000)}`;
  if (text) prompt += `\n\nNote: "${text}"`;

  const out = await ai({ prompt, files: atts.length ? atts : undefined });
  const cleaned = stripFences(out);
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  let raw;
  if (arrMatch) raw = JSON.parse(arrMatch[0]);
  else if (objMatch) raw = [JSON.parse(objMatch[0])];
  else throw new Error("no-json");
  if (!Array.isArray(raw)) raw = [raw];

  const byId = (id) => accs.find((a) => a.id === id);
  const resolve = (v) => {
    if (!v) return null;
    if (byId(v)) return v;
    const hit = accs.find((a) => a.name.toLowerCase().includes(String(v).toLowerCase()));
    return hit ? hit.id : null;
  };
  const norm = (p) => {
    const type = ["expense", "income", "transfer"].includes(p.type) ? p.type : "expense";
    return {
      type,
      fromId: type === "income" ? null : resolve(p.fromId) || accs[0]?.id,
      toId: type === "expense" ? null : resolve(p.toId) || accs[1]?.id,
      fromAmount: Number(p.fromAmount) || 0,
      toAmount: p.toAmount != null ? Number(p.toAmount) : undefined,
      category: (p.category || "").toString().slice(0, 30),
      subcategory: (p.subcategory || "").toString().slice(0, 30),
      date: /^\d{4}-\d{2}-\d{2}$/.test(p.date || "") ? p.date : today,
      note: (p.note || "").toString().slice(0, 80),
    };
  };
  const exists = (id) => accs.some((a) => a.id === id);
  const list = raw
    .map(norm)
    .map((t) => (memory ? applyMemory(memory, t, { accountExists: exists }) : t))
    .filter((t) => t.fromAmount || t.toAmount);
  if (!list.length) throw new Error("empty");
  return list;
}

/* Several receipts in one go.

   The failure this is shaped around is not a model failure, it is an
   arithmetic one. Three receipts sent in a single call come back as one blur
   of line items with the totals silently pooled; sent one call each, every
   receipt keeps its own store, its own date and its own total, and a receipt
   that cannot be read costs its own rows instead of the whole batch. Reading
   is sequential for the same reason the statement sweep is: a burst of
   parallel vision calls is exactly what a free-tier key answers with 429s. */
export async function parseReceipts(accs, { items, text, payFrom, memory }, ai, onProgress) {
  const list = (items || []).filter((it) => it && ((it.files && it.files.length) || it.docText));
  if (!list.length) throw new Error("empty-input");

  const rows = [];
  const failed = [];
  for (let i = 0; i < list.length; i++) {
    if (onProgress) onProgress({ done: i, of: list.length, name: list[i].name });
    try {
      const got = await parseEntry(accs, { ...list[i], text, payFrom, memory }, ai);
      rows.push(...got.map((r) => ({ ...r, _source: list[i].name })));
    } catch (e) {
      failed.push({ name: list[i].name || `file ${i + 1}`, error: (e && e.message) || "failed" });
    }
  }
  if (onProgress) onProgress({ done: list.length, of: list.length });
  if (!rows.length) throw new Error(failed.length ? "all-failed" : "empty");
  return { rows, failed };
}

/* ---------- offline heuristic ---------- */
export function localParse(accs, text, memory) {
  const t = " " + text.toLowerCase() + " ";
  const today = new Date().toISOString().slice(0, 10);
  let amount = 0;
  const m = t.match(/(\d[\d,]*\.?\d*)\s*(k|الف|ألف)?/);
  if (m) {
    amount = parseFloat(m[1].replace(/,/g, "")) || 0;
    if (m[2]) amount *= 1000;
  }
  const has = (arr) => arr.some((w) => t.includes(w));
  const incomeW = ["salary", "income", "received", "refund", "راتب", "دخل", "استلمت", "حصلت"];
  const goldW = ["gold", "دهب", "ذهب", "جرام", "عيار"];
  const transferW = ["transfer", "move", "into clouds", "to clouds", "buy", "bought", "اشتريت", "حولت", "حول", "اشترى"];

  /* What this note reminds the ledger of, if anything. It answers only where
     the keyword table below has nothing to say — the table is about words
     everyone uses the same way, memory is about the ones only you do. */
  const hit = memory ? recall(memory, text) : null;

  let type = "expense";
  let signalled = true;
  if (has(incomeW)) type = "income";
  else if (has(goldW) || has(transferW)) type = "transfer";
  else signalled = false;
  // "gym 400" carries no keyword at all; if it has been an expense forty times
  // there is no reason to make the user restate that
  if (!signalled && hit) type = hit.type;

  const cash = accs.find((a) => a.assetClass === "Cash" && !a.isLiability && a.unit === "EGP") || accs[0];
  const mm = accs.find((a) => a.assetClass === "Money market") || accs[0];
  const goldAcc = accs.find((a) => a.assetClass === "Gold" && a.unit === "GOLD") || accs.find((a) => a.assetClass === "Gold");
  const findByName = () =>
    accs.find((a) => {
      const tok = a.name.toLowerCase().split(/[ (—\-]/)[0];
      return tok.length > 2 && t.includes(tok);
    });

  /* An account the note names outranks memory; memory outranks the blanket
     "assume cash" default, which is the one that was wrong most often. */
  const exists = (id) => id && accs.some((a) => a.id === id);
  const named = findByName();
  const remembered = (side) => (hit && hit.type === type && exists(hit[side]) ? accs.find((a) => a.id === hit[side]) : null);

  let fromId = null, toId = null, fromAmount = 0, toAmount;
  if (type === "income") {
    toId = (named || remembered("toId") || mm)?.id;
    toAmount = amount;
  } else if (type === "transfer") {
    fromId = (named || remembered("fromId") || cash)?.id;
    fromAmount = amount;
    const dest = has(goldW) ? goldAcc : remembered("toId") || mm;
    toId = dest ? dest.id : undefined;
  } else {
    fromId = (named || remembered("fromId") || cash)?.id;
    fromAmount = amount;
  }

  let category = "", subcategory = "";
  if (has(["grocer", "supermarket", "بقالة", "سوبر"])) (category = "Food"), (subcategory = "Groceries");
  else if (has(["coffee", "قهوة", "كافيه"])) (category = "Food"), (subcategory = "Coffee");
  else if (has(["lunch", "dinner", "restaurant", "اكل", "مطعم", "غداء", "عشاء"])) (category = "Food"), (subcategory = "Restaurants");
  else if (has(["uber", "taxi", "تاكسي", "اوبر"])) (category = "Transport"), (subcategory = "Taxi/Uber");
  else if (has(["fuel", "petrol", "بنزين", "وقود"])) (category = "Transport"), (subcategory = "Fuel");
  else if (has(incomeW)) (category = "Income"), (subcategory = "Salary");
  else if (has(goldW)) (category = "Investment"), (subcategory = "Gold");
  else if (has(["zakat", "زكاة", "صدقة", "sadaqah"])) (category = "Giving"), (subcategory = has(["zakat", "زكاة"]) ? "Zakat" : "Sadaqah");

  // the table knows nothing about this note, but the ledger might
  if (!category && hit && hit.type === type) {
    category = hit.category;
    subcategory = hit.subcategory;
  }

  return { type, fromId, toId, fromAmount, toAmount, category, subcategory, date: today, note: text.slice(0, 80) };
}

export function localParseMany(accs, text, memory) {
  const chunks = text
    .split(/\n|،|,|;|\bثم\b|\band\b|\sو\s|\+/i)
    .map((s) => s.trim())
    .filter(Boolean);
  const withNum = chunks.filter((c) => /\d/.test(c));
  const src = withNum.length ? withNum : [text];
  return src.map((c) => localParse(accs, c, memory));
}

/* ---------- bulk balance sync ---------- */
export async function parseBalances(targets, { text, image, files, docText }, ai) {
  const atts = [image, ...(files || [])].filter(Boolean);
  const list = targets.map((a) => ({ id: a.id, name: a.name, unit: a.unit }));
  const instr =
    "From the note and/or screenshot of a brokerage app, read the CURRENT balance of each listed holding. " +
    `Holdings as JSON: ${JSON.stringify(list)}. ` +
    "For EGP/USD holdings give the money value; for a GOLD holding give grams. " +
    'Reply with ONLY a JSON object mapping account id to number, e.g. {"a1":338564,"a3":45725}. Omit any you cannot read. No prose, no fences.';
  let prompt = instr;
  if (docText) prompt += `\n\nStatement text:\n${docText.slice(0, 24000)}`;
  if (text || !atts.length) prompt += `\n\nNote: "${text || ""}"`;
  const out = await ai({ prompt, files: atts.length ? atts : undefined });
  const m = stripFences(out).match(/\{[\s\S]*\}/);
  if (!m) throw new Error("no-json");
  const obj = JSON.parse(m[0]);
  const result = {};
  Object.keys(obj).forEach((k) => {
    const n = Number(obj[k]);
    if (targets.some((a) => a.id === k) && isFinite(n)) result[k] = n;
  });
  return result;
}

export function localParseBalances(targets, text) {
  const t = text.toLowerCase();
  const result = {};
  targets.forEach((a) => {
    const toks = a.name
      .toLowerCase()
      .replace(/[()—\-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !["the", "fund"].includes(w));
    for (const tok of toks) {
      const re = new RegExp(tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[^\\d]{0,14}(\\d[\\d,\\.]*)\\s*(k)?", "i");
      const mm = t.match(re);
      if (mm) {
        let n = parseFloat(mm[1].replace(/,/g, "")) || 0;
        if (mm[2]) n *= 1000;
        if (n) { result[a.id] = n; break; }
      }
    }
  });
  return result;
}
