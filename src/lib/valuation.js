/* Valuation: turning balances and transactions into EGP.

   The important rule lives here. An account's *balance* is worth whatever
   today's price says — that is the whole point of a live net-worth figure. A
   *transaction*, though, happened at a moment in time, and re-pricing it later
   silently rewrites history: before this, a $100 dinner logged last year grew
   every time the pound weakened, and last year's "spent in March" total moved
   with the gold price. So every transaction records the EGP rate that applied
   when it was logged, and all spending analysis reads that snapshot. */

export const OZ_TO_GRAM = 31.1034768;

export function karatPrice(prices, karat) {
  return (Number(prices && prices.gold24) || 0) * (Number(karat) || 24) / 24;
}

/* EGP per one unit of `unit` (one dollar, one gram at that karat, one pound) */
export function unitRate(unit, karat, prices) {
  if (unit === "USD") return Number(prices && prices.usdEgp) || 0;
  if (unit === "GOLD") return karatPrice(prices, karat || 24);
  return 1;
}

/* EGP per one unit of an account's holding; null when the account is gone */
export function rateFor(acc, prices) {
  if (!acc) return null;
  return unitRate(acc.unit, acc.karat, prices);
}

export function egpValue(acc, prices) {
  return (Number(acc && acc.balance) || 0) * (rateFor(acc, prices) ?? 1);
}

export function unitLabel(acc) {
  if (!acc) return "";
  const unit = typeof acc === "string" ? acc : acc.unit;
  if (unit === "USD") return "$";
  if (unit === "GOLD") return "g";
  return "EGP";
}

export const findAcc = (accounts, id) => (id ? (accounts || []).find((a) => a.id === id) : undefined);

/* Capture what each side of a transaction was worth at the time it was logged.
   Also copies the account names, so deleting an account later leaves the
   history readable instead of rendering "undefined →". */
export function snapshotSides(txn, accounts, prices) {
  const from = findAcc(accounts, txn.fromId);
  const to = findAcc(accounts, txn.toId);
  const out = { ...txn };
  if (from) {
    out.fromUnit = from.unit;
    out.fromKarat = from.karat;
    out.fromName = from.name;
    out.fromRate = rateFor(from, prices);
  }
  if (to) {
    out.toUnit = to.unit;
    out.toKarat = to.karat;
    out.toName = to.name;
    out.toRate = rateFor(to, prices);
  }
  return out;
}

/* The rate to use when valuing one side of a stored transaction:
   its own snapshot first, then the live account, then the remembered unit,
   and only then a bare 1:1 — which is correct for EGP and the least wrong
   guess for anything else. */
function sideRate(txn, side, accounts, prices) {
  const snap = txn[side + "Rate"];
  if (snap != null && isFinite(snap)) return Number(snap);
  const acc = findAcc(accounts, txn[side + "Id"]);
  if (acc) return rateFor(acc, prices);
  const unit = txn[side + "Unit"];
  if (unit) return unitRate(unit, txn[side + "Karat"], prices);
  return 1;
}

/* EGP that left the wallet (expense, or the outgoing leg of a transfer) */
export function outEgp(txn, accounts, prices) {
  return (Number(txn.fromAmount) || 0) * sideRate(txn, "from", accounts, prices);
}

/* EGP that arrived (income, or the incoming leg of a transfer) */
export function inEgp(txn, accounts, prices) {
  return (Number(txn.toAmount) || 0) * sideRate(txn, "to", accounts, prices);
}

/* label for an account reference that may no longer exist */
export function sideName(txn, side, accounts) {
  const acc = findAcc(accounts, txn[side + "Id"]);
  if (acc) return acc.name;
  return txn[side + "Name"] || "removed account";
}

export function sideUnitLabel(txn, side, accounts) {
  const acc = findAcc(accounts, txn[side + "Id"]);
  if (acc) return unitLabel(acc);
  return unitLabel(txn[side + "Unit"] || "EGP");
}
