/* Mizan data model — shared verbatim by the browser app and the sync server.

   Keep this file free of DOM, React, Node and network APIs: `api/` imports it
   inside a Vercel function and `src/` imports it into the bundle, so anything
   environment-specific here breaks one side or the other.

   Why records carry timestamps
   ----------------------------
   Sync merges two documents that were both edited offline, so "which copy is
   right" has to be answerable per record, not per document. Every record gets
   `updatedAt`, and deletes are soft (`deletedAt`) — a hard delete is invisible
   to the other device, which would happily resurrect the row on the next
   merge. Tombstones are pruned once they are older than any plausible
   offline gap (see TOMBSTONE_TTL_DAYS). */

export const SCHEMA_VERSION = 2;

/* collections merged record-by-record, and the field that identifies a record */
export const COLLECTIONS = {
  accounts: "id",
  transactions: "id",
  debts: "id",
  recurring: "id",
  history: "d",       // one net-worth snapshot per calendar day
  priceHistory: "d",  // one gold/FX close per calendar day
};

/* maps that are replaced wholesale, timestamped in meta.updatedAt */
export const SCALARS = ["targets", "budgets", "zakat"];

export const TOMBSTONE_TTL_DAYS = 120;

/* Retention: a year of daily snapshots is enough for every chart in the app
   and keeps the synced document comfortably small. */
export const HISTORY_LIMIT = 400;

export const CLASS_ORDER = ["Money market", "Gold", "Equity", "Cash", "Illiquid"];
export const LIQUID_CLASSES = ["Money market", "Gold", "Equity", "Cash"];
export const ILLIQUID_CLASS = "Illiquid";

/* main category -> subcategories (defaults; custom values are always allowed) */
export const TAXONOMY = {
  Food: ["Groceries", "Restaurants", "Coffee", "Delivery"],
  Transport: ["Fuel", "Taxi/Uber", "Public transport", "Car/Maintenance", "Parking"],
  Housing: ["Rent", "Utilities", "Internet/Phone", "Maintenance", "Furniture"],
  Family: ["Childcare", "Education", "Kids/Clothing", "Activities"],
  Health: ["Doctor", "Pharmacy", "Insurance", "Fitness"],
  Shopping: ["Electronics", "Clothing", "Household", "Gifts"],
  Bills: ["Subscriptions", "Phone", "Internet", "Insurance"],
  Investment: ["Gold", "Equity", "Savings", "Real estate"],
  Giving: ["Zakat", "Sadaqah", "Gifts"],
  Personal: ["Entertainment", "Travel", "Self-care", "Misc"],
  Income: ["Salary", "Freelance", "Dividends", "Other"],
  Other: [],
};
export const MAIN_CATS = Object.keys(TAXONOMY);

/* Zakat defaults. Gold nisab (85g) is the lenient standard; silver (595g) is
   far lower in modern prices and is the cautious choice most scholars
   recommend when wealth is mixed. The user picks; we default to silver. */
export const ZAKAT_DEFAULTS = {
  standard: "silver", // "silver" | "gold"
  hawlStart: null,    // ISO date the holder first crossed nisab
  includeIlliquid: false,
};

export const NISAB_GRAMS = { gold: 85, silver: 595 };

/* New users start on a clean slate — no demo accounts or holdings. */
export function emptyState() {
  return {
    v: SCHEMA_VERSION,
    accounts: [],
    transactions: [],
    debts: [],
    recurring: [],
    history: [],
    priceHistory: [],
    targets: { "Money market": 0, Gold: 0, Equity: 0, Cash: 0 },
    budgets: {},
    zakat: { ...ZAKAT_DEFAULTS },
    meta: { updatedAt: {} },
  };
}

export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

export const today = () => new Date().toISOString().slice(0, 10);

/* stamp a record as changed now — every write path goes through this */
export function touch(record, at) {
  return { ...record, updatedAt: at || Date.now() };
}

/* soft delete: the row stays so the other device learns about the removal */
export function tombstone(record, at) {
  return { ...record, deletedAt: at || Date.now(), updatedAt: at || Date.now() };
}

export const isLive = (r) => r && !r.deletedAt;

/* live rows of a collection, in stored order */
export function live(state, key) {
  return (state[key] || []).filter(isLive);
}

/* mark a scalar map (targets/budgets/zakat) as changed */
export function touchScalar(state, key, value, at) {
  return {
    ...state,
    [key]: value,
    meta: { ...state.meta, updatedAt: { ...(state.meta && state.meta.updatedAt), [key]: at || Date.now() } },
  };
}

/* ---------- migration ----------
   v1 was the original shape: bare arrays with no timestamps, history kept in
   its own storage key, no debts/recurring guarantees. Anything missing is
   filled from emptyState() so a partial backup can no longer crash a tab. */
export function migrate(raw, extra = {}) {
  const base = emptyState();
  if (!raw || typeof raw !== "object") return base;

  const now = Date.now();
  // v1 records predate sync; stamping them "now" is wrong in principle but
  // harmless: the first device to sync simply wins, and there is no remote
  // copy to lose yet.
  const stampAll = (arr, idField) =>
    (Array.isArray(arr) ? arr : [])
      .filter((r) => r && typeof r === "object" && r[idField] != null)
      .map((r) => (r.updatedAt ? r : { ...r, updatedAt: now }));

  const out = {
    ...base,
    ...raw,
    v: SCHEMA_VERSION,
    accounts: stampAll(raw.accounts, "id"),
    transactions: stampAll(raw.transactions, "id"),
    debts: stampAll(raw.debts, "id"),
    recurring: stampAll(raw.recurring, "id"),
    history: stampAll(raw.history && raw.history.length ? raw.history : extra.history, "d"),
    priceHistory: stampAll(raw.priceHistory, "d"),
    targets: { ...base.targets, ...(raw.targets && typeof raw.targets === "object" ? raw.targets : {}) },
    budgets: raw.budgets && typeof raw.budgets === "object" ? raw.budgets : {},
    zakat: { ...ZAKAT_DEFAULTS, ...(raw.zakat && typeof raw.zakat === "object" ? raw.zakat : {}) },
    meta: { updatedAt: { ...(raw.meta && raw.meta.updatedAt) } },
  };

  // numbers arriving from a hand-edited backup must not poison every total
  out.accounts = out.accounts.map((a) => ({
    ...a,
    balance: Number(a.balance) || 0,
    karat: a.karat ? Number(a.karat) : undefined,
    assetClass: CLASS_ORDER.includes(a.assetClass) ? a.assetClass : "Cash",
  }));
  out.transactions = out.transactions.map((t) => ({
    ...t,
    fromAmount: Number(t.fromAmount) || 0,
    toAmount: Number(t.toAmount) || 0,
  }));
  return out;
}

/* ---------- merge ----------
   Symmetric and idempotent: mergeState(a, b) and mergeState(b, a) agree, and
   merging a document with itself changes nothing. That is what lets the client
   push its whole document and adopt whatever comes back without bookkeeping.

   Newest `updatedAt` wins. Ties break on the copy that is deleted, so a delete
   racing an edit at the same millisecond settles the same way on both sides
   rather than flapping between devices. */
function mergeCollection(a = [], b = [], idField) {
  const out = new Map();
  const consider = (r) => {
    if (!r || r[idField] == null) return;
    const key = String(r[idField]);
    const cur = out.get(key);
    if (!cur) { out.set(key, r); return; }
    const ra = Number(cur.updatedAt) || 0;
    const rb = Number(r.updatedAt) || 0;
    if (rb > ra) out.set(key, r);
    else if (rb === ra && r.deletedAt && !cur.deletedAt) out.set(key, r);
  };
  a.forEach(consider);
  b.forEach(consider);
  return [...out.values()];
}

function mergeScalar(a, b, key) {
  const ta = Number(a.meta && a.meta.updatedAt && a.meta.updatedAt[key]) || 0;
  const tb = Number(b.meta && b.meta.updatedAt && b.meta.updatedAt[key]) || 0;
  return tb > ta ? { value: b[key], at: tb } : { value: a[key], at: ta };
}

export function mergeState(a, b) {
  const left = migrate(a);
  const right = migrate(b);
  const out = { v: SCHEMA_VERSION, meta: { updatedAt: {} } };

  for (const [key, idField] of Object.entries(COLLECTIONS)) {
    out[key] = mergeCollection(left[key], right[key], idField);
  }
  for (const key of SCALARS) {
    const { value, at } = mergeScalar(left, right, key);
    out[key] = value;
    if (at) out.meta.updatedAt[key] = at;
  }

  // keep the day-series ordered and bounded; merge can interleave them
  for (const key of ["history", "priceHistory"]) {
    out[key] = out[key].sort((x, y) => (x.d < y.d ? -1 : 1)).slice(-HISTORY_LIMIT);
  }
  // newest transactions first, matching how the Activity tab reads them
  out.transactions.sort((x, y) => (y.date || "").localeCompare(x.date || "") || (y.updatedAt || 0) - (x.updatedAt || 0));

  return prune(out);
}

/* drop tombstones old enough that no offline device could still be unaware */
export function prune(state, now = Date.now()) {
  const cutoff = now - TOMBSTONE_TTL_DAYS * 86400000;
  const out = { ...state };
  for (const key of Object.keys(COLLECTIONS)) {
    out[key] = (state[key] || []).filter((r) => !r.deletedAt || (Number(r.updatedAt) || 0) > cutoff);
  }
  return out;
}

/* rough byte size of the synced document — the server rejects oversized pushes
   rather than letting one runaway device fill the row */
export function docSize(doc) {
  try { return JSON.stringify(doc).length; } catch { return Infinity; }
}
export const MAX_DOC_BYTES = 4 * 1024 * 1024;

/* ---------- fingerprint ----------
   "Has this document actually changed?" cannot be answered with
   JSON.stringify: key order is an artefact of how an object was built, and the
   server builds the merged document in a different order than migrate() does
   on the way back in. Comparing raw JSON therefore reported a difference on
   every single round trip, and the client pushed forever in a loop.

   This serialises deterministically — keys sorted, undefined dropped — so two
   documents with the same content always produce the same string. Array order
   is still significant, which is correct: reordering the ledger is a real
   change. */
function stable(v) {
  if (v === null || typeof v !== "object") {
    const s = JSON.stringify(v);
    return s === undefined ? "null" : s;
  }
  if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
}

export function fingerprint(doc) {
  try { return stable(doc); } catch { return null; }
}

export const sameDoc = (a, b) => fingerprint(a) === fingerprint(b);
