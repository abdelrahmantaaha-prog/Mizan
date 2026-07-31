/* Turning notes, dictation and receipt photos into transactions.

   Two parsers live here: the AI one, and a deliberately dumb offline
   heuristic. The offline path exists because a finance app that refuses to
   record a coffee because a model was unreachable is worse than one that
   records it roughly and asks you to check. */

import { TAXONOMY } from "../../shared/model.js";

export function withTimeout(p, ms) {
  let t;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise((_, rej) => { t = setTimeout(() => rej(new Error("timeout")), ms); }),
  ]);
}

const stripFences = (s) => s.replace(/```json/gi, "").replace(/```/g, "");

/* ---------- transactions ---------- */
export async function parseEntry(accs, { text, image, payFrom }, ai) {
  const today = new Date().toISOString().slice(0, 10);
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

  const prompt = image
    ? instructions + (text ? `\n\nNote: "${text}"` : "\n\nThe image is a receipt — split its items into per-category transactions.")
    : instructions + `\n\nNote: "${text}"`;

  const out = await ai({ prompt, image: image || undefined });
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
  const list = raw.map(norm).filter((t) => t.fromAmount || t.toAmount);
  if (!list.length) throw new Error("empty");
  return list;
}

/* ---------- offline heuristic ---------- */
export function localParse(accs, text) {
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
  let type = "expense";
  if (has(incomeW)) type = "income";
  else if (has(goldW) || has(transferW)) type = "transfer";

  const cash = accs.find((a) => a.assetClass === "Cash" && !a.isLiability && a.unit === "EGP") || accs[0];
  const mm = accs.find((a) => a.assetClass === "Money market") || accs[0];
  const goldAcc = accs.find((a) => a.assetClass === "Gold" && a.unit === "GOLD") || accs.find((a) => a.assetClass === "Gold");
  const findByName = () =>
    accs.find((a) => {
      const tok = a.name.toLowerCase().split(/[ (—\-]/)[0];
      return tok.length > 2 && t.includes(tok);
    });

  let fromId = null, toId = null, fromAmount = 0, toAmount;
  if (type === "income") {
    toId = (findByName() || mm)?.id;
    toAmount = amount;
  } else if (type === "transfer") {
    fromId = (findByName() || cash)?.id;
    fromAmount = amount;
    const dest = has(goldW) ? goldAcc : mm;
    toId = dest ? dest.id : undefined;
  } else {
    fromId = (findByName() || cash)?.id;
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

  return { type, fromId, toId, fromAmount, toAmount, category, subcategory, date: today, note: text.slice(0, 80) };
}

export function localParseMany(accs, text) {
  const chunks = text
    .split(/\n|،|,|;|\bثم\b|\band\b|\sو\s|\+/i)
    .map((s) => s.trim())
    .filter(Boolean);
  const withNum = chunks.filter((c) => /\d/.test(c));
  const src = withNum.length ? withNum : [text];
  return src.map((c) => localParse(accs, c));
}

/* ---------- bulk balance sync ---------- */
export async function parseBalances(targets, { text, image }, ai) {
  const list = targets.map((a) => ({ id: a.id, name: a.name, unit: a.unit }));
  const instr =
    "From the note and/or screenshot of a brokerage app, read the CURRENT balance of each listed holding. " +
    `Holdings as JSON: ${JSON.stringify(list)}. ` +
    "For EGP/USD holdings give the money value; for a GOLD holding give grams. " +
    'Reply with ONLY a JSON object mapping account id to number, e.g. {"a1":338564,"a3":45725}. Omit any you cannot read. No prose, no fences.';
  const prompt = image ? instr + (text ? `\n\nNote: "${text}"` : "") : instr + `\n\nNote: "${text}"`;
  const out = await ai({ prompt, image: image || undefined });
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
