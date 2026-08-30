/* Merchant memory — the ledger teaching the app your own habits.

   The offline parser in parse.js reads a fixed keyword table: "coffee" is
   Food/Coffee for everybody, and anything it has never heard of comes back
   uncategorised. But the thing being logged for the fortieth time is almost
   never new — it is Uber, it is the same supermarket, it is the same gym.
   Those forty rows are already sitting in the ledger with the answer on them.

   So this indexes your own transactions by the words in their notes and hands
   back what you did last time: category, subcategory, which account paid, and
   what it usually costs. Two consequences, both aimed at the same thing —
   logging something without thinking about it:

     - the offline path stops being a downgrade for anything repeated, so a
       missing key or a dead network costs nothing on the common case;
     - a repeat with a number in it can be logged in one tap, with no model
       call and no round trip at all.

   Recency is weighted, not counted. Moving from cash to a card should change
   the answer within a few uses rather than being outvoted for a year by
   history, so every occurrence decays with a 90-day half-life.

   Nothing here writes. It proposes, and Activity shows the proposal with the
   amount and the account visible before anything is committed — the same
   contract recurring.js keeps. */

const HALF_LIFE_DAYS = 90;
const MIN_TOKEN = 3;

/* Words that appear in notes everywhere and therefore identify nothing. The
   Arabic list is the same idea: prepositions, and the "I bought / I paid"
   verbs that open half of a dictated note. */
const STOP = new Set([
  "the", "and", "for", "from", "with", "was", "were", "this", "that", "have",
  "spent", "paid", "bought", "got", "cash", "card", "egp", "pounds", "pound",
  "today", "yesterday", "morning", "evening", "night", "some", "just", "about",
  "من", "على", "في", "الى", "عند", "بعد", "قبل", "اليوم", "امبارح",
  "دفعت", "اشتريت", "خدت", "جنيه", "جنيها", "كان", "علي",
]);

/* Arabic arrives from dictation and from keyboards that disagree about hamza,
   ya and ta marbuta, so "أوبر" and "اوبر" have to land on the same token — or
   the memory splits in half and neither half ever reaches confidence. */
export function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "") // tashkeel and tatweel
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(s) {
  return normalize(s)
    .split(" ")
    .filter((w) => w.length >= MIN_TOKEN && !STOP.has(w) && !/^\d+$/.test(w));
}

const dayOf = (iso) => {
  const t = Date.parse((iso || "") + "T00:00:00Z");
  return Number.isFinite(t) ? t : Date.now();
};

/* A transaction's shape as a memory answer: what it was, and where it came
   from or went. Amounts are kept per outcome so a confident recall can also
   propose the usual number. */
function outcomeOf(t) {
  return {
    type: t.type,
    category: t.category || "",
    subcategory: t.subcategory || "",
    fromId: t.fromId || null,
    toId: t.toId || null,
  };
}
const outcomeKey = (o) => [o.type, o.category, o.subcategory, o.fromId || "", o.toId || ""].join("|");

/* Median, not mean: one 4,000 EGP airport ride should not drag the proposed
   amount away from the 70 EGP the other thirty rides cost. */
function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/* token -> { total, outcomes: Map<key, { weight, outcome, amounts, count, last }> } */
export function buildMemory(txns, now = Date.now()) {
  const byToken = new Map();
  const rows = (txns || []).filter((t) => t && !t.deletedAt);

  for (const t of rows) {
    const age = Math.max(0, (now - dayOf(t.date)) / 86400000);
    const weight = Math.pow(0.5, age / HALF_LIFE_DAYS);
    if (weight < 0.01) continue; // ~10 half-lives old: it cannot win anything

    // the note is what people actually type; the subcategory catches rows that
    // were filed by hand with no note at all
    const words = new Set([...tokenize(t.note), ...tokenize(t.subcategory)]);
    if (!words.size) continue;

    const outcome = outcomeOf(t);
    const key = outcomeKey(outcome);
    const amount = t.type === "income" ? Number(t.toAmount) || 0 : Number(t.fromAmount) || 0;

    for (const w of words) {
      let entry = byToken.get(w);
      if (!entry) { entry = { total: 0, outcomes: new Map() }; byToken.set(w, entry); }
      entry.total += weight;
      let o = entry.outcomes.get(key);
      if (!o) { o = { weight: 0, outcome, amounts: [], count: 0, last: t.date || "" }; entry.outcomes.set(key, o); }
      o.weight += weight;
      o.count += 1;
      if (amount) o.amounts.push(amount);
      if ((t.date || "") > o.last) o.last = t.date || "";
    }
  }
  return { byToken, size: byToken.size };
}

/* The best answer this memory has for a note, or null.

   `share` is how dominant the winning outcome is for that word, and it is the
   part that matters: a token seen twenty times but split evenly between
   Groceries and Household knows nothing useful and must not be allowed to
   answer at all. */
export function recall(memory, text, opts = {}) {
  const minCount = opts.minCount == null ? 2 : opts.minCount;
  const minShare = opts.minShare == null ? 0.6 : opts.minShare;
  if (!memory || !memory.byToken || !memory.byToken.size) return null;
  const words = tokenize(text);
  if (!words.length) return null;

  let best = null;
  for (const w of words) {
    const entry = memory.byToken.get(w);
    if (!entry) continue;
    for (const o of entry.outcomes.values()) {
      if (o.count < minCount) continue;
      const share = entry.total ? o.weight / entry.total : 0;
      if (share < minShare) continue;
      // a longer token is a more specific one — a store name beats "market"
      const score = o.weight * share * (1 + w.length / 40);
      if (!best || score > best.score) {
        best = { score, share, token: w, count: o.count, last: o.last, ...o.outcome, amount: median(o.amounts) };
      }
    }
  }
  if (!best) return null;
  const { score, ...out } = best;
  return out;
}

/* Fill only the blanks a parse left behind. Never overrides something the
   model or the user was explicit about — memory is the weaker source, and a
   receipt line that says Household must not be rewritten to Groceries just
   because the store name usually means food. */
export function applyMemory(memory, txn, opts = {}) {
  const accountExists = opts.accountExists || (() => true);
  const hit = recall(memory, [txn.note, txn.subcategory, txn.category].filter(Boolean).join(" "));
  if (!hit || hit.type !== txn.type) return txn;
  const out = { ...txn };
  if (!out.category && hit.category) out.category = hit.category;
  if (!out.subcategory && hit.subcategory) out.subcategory = hit.subcategory;
  if (out.type !== "income" && !out.fromId && hit.fromId && accountExists(hit.fromId)) out.fromId = hit.fromId;
  if (out.type !== "expense" && !out.toId && hit.toId && accountExists(hit.toId)) out.toId = hit.toId;
  return out;
}

/* ---------- one-tap repeats ---------- */

const AR_DIGITS = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9" };

export function readAmount(text) {
  const t = String(text || "").replace(/[٠-٩]/g, (d) => AR_DIGITS[d]);
  const m = t.match(/(\d[\d,]*\.?\d*)\s*(k|الف|ألف)?/i);
  if (!m) return 0;
  let n = parseFloat(m[1].replace(/,/g, "")) || 0;
  if (m[2]) n *= 1000;
  return n;
}

/* The instant proposal shown under the quick-add box.

   Deliberately stricter than recall(): this one sits a single tap away from
   being written, so it asks for a clearer history behind it than a field that
   is merely being prefilled for review. A note with no number still matches —
   it proposes the usual amount and says so, because "uber" on its own is the
   laziest possible entry and the one worth answering. */
export function instantMatch(memory, text, accs, opts = {}) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const hit = recall(memory, raw, { minCount: 3, minShare: 0.7 });
  if (!hit) return null;
  const has = (id) => !id || (accs || []).some((a) => a.id === id);
  if (!has(hit.fromId) || !has(hit.toId)) return null;

  const typed = readAmount(raw);
  const amount = typed || hit.amount;
  if (!amount) return null;

  const date = opts.today || new Date().toISOString().slice(0, 10);
  return {
    hit,
    usedTypical: !typed,
    txn: {
      type: hit.type,
      fromId: hit.type === "income" ? null : hit.fromId,
      toId: hit.type === "expense" ? null : hit.toId,
      fromAmount: hit.type === "income" ? 0 : amount,
      toAmount: hit.type === "income" ? amount : undefined,
      category: hit.category,
      subcategory: hit.subcategory,
      date,
      note: raw.slice(0, 80),
    },
  };
}
