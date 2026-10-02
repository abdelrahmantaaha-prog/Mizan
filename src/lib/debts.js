/* Debts as the far side of a transfer.

   A debt is one counterparty and a net figure: they owe me (`dir: "owed"`) or
   I owe them (`dir: "owe"`), always in EGP. Money sent to them from one of my
   accounts moves that figure toward "they owe me"; money received from them
   moves it toward "I owe them". Either can cross zero — lend 1,000 to someone
   I owed 400 and they now owe me 600 — so the record is worked out from the
   signed net rather than nudged in its own direction.

   In a transaction the debt sits where an account id would, prefixed so no
   account lookup can ever mistake it for one. The rest of the app needs no
   special case: the side's name and EGP rate are snapshotted like any other,
   and transfers are already left out of spending. */

export const DEBT_PREFIX = "debt:";

export const isDebtSide = (id) => typeof id === "string" && id.startsWith(DEBT_PREFIX);
export const debtIdOf = (sideId) => (isDebtSide(sideId) ? sideId.slice(DEBT_PREFIX.length) : null);

/* a debt shaped like an account, for pickers and for snapshotSides */
export function debtSide(d) {
  return { id: DEBT_PREFIX + d.id, name: d.name, unit: "EGP", debt: true };
}

/* positive: they owe me; negative: I owe them */
export const debtNet = (d) => (d.dir === "owe" ? -1 : 1) * (Number(d.amount) || 0);

/* the debt after `delta` EGP more of "they owe me" (negative = less) */
export function shiftDebt(d, delta) {
  const net = Math.round((debtNet(d) + delta) * 100) / 100;
  return { ...d, dir: net > 0 ? "owed" : net < 0 ? "owe" : d.dir, amount: Math.abs(net) };
}

/* How a transaction moves each debt it touches, by debt id. `sign` is 1 to
   apply it and -1 to reverse it. Sending to a debt raises what they owe me;
   receiving from one lowers it. */
export function debtDeltas(t, sign = 1) {
  const out = {};
  if (t.type !== "transfer") return out;
  const to = debtIdOf(t.toId);
  const from = debtIdOf(t.fromId);
  if (to) out[to] = (out[to] || 0) + sign * (Number(t.toAmount) || 0);
  if (from) out[from] = (out[from] || 0) - sign * (Number(t.fromAmount) || 0);
  return out;
}
