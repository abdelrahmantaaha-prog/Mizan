/* Money moved to and from someone in the debt ledger. The figure has to cross
   zero correctly, and reversing a transfer has to land exactly where it began
   — otherwise deleting or editing one quietly rewrites what someone owes. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { DEBT_PREFIX, isDebtSide, debtIdOf, debtSide, debtNet, shiftDebt, debtDeltas } from "../src/lib/debts.js";
import { snapshotSides, sideName, findAcc } from "../src/lib/valuation.js";

const dats = { id: "d1", dir: "owed", name: "DATS", amount: 1000 };

test("debt sides are told apart from accounts", () => {
  assert.equal(isDebtSide(DEBT_PREFIX + "d1"), true);
  assert.equal(isDebtSide("d1"), false);
  assert.equal(isDebtSide(null), false);
  assert.equal(debtIdOf("debt:d1"), "d1");
  assert.equal(debtIdOf("acc1"), null);
});

test("net is signed by direction", () => {
  assert.equal(debtNet(dats), 1000);
  assert.equal(debtNet({ dir: "owe", amount: 300 }), -300);
});

test("lending more raises what they owe me", () => {
  assert.deepEqual(shiftDebt(dats, 500), { ...dats, dir: "owed", amount: 1500 });
});

test("being paid back can cross zero into what I owe", () => {
  assert.deepEqual(shiftDebt(dats, -1400), { ...dats, dir: "owe", amount: 400 });
});

test("paying down what I owe can cross into what they owe me", () => {
  const owe = { id: "d2", dir: "owe", name: "DATS", amount: 400 };
  assert.deepEqual(shiftDebt(owe, 1000), { ...owe, dir: "owed", amount: 600 });
});

test("landing on zero keeps the direction and reads even", () => {
  const s = shiftDebt(dats, -1000);
  assert.equal(s.amount, 0);
  assert.equal(s.dir, "owed");
});

test("transfer to a debt raises it, from a debt lowers it", () => {
  assert.deepEqual(debtDeltas({ type: "transfer", fromId: "acc", toId: "debt:d1", fromAmount: 200, toAmount: 200 }), { d1: 200 });
  assert.deepEqual(debtDeltas({ type: "transfer", fromId: "debt:d1", toId: "acc", fromAmount: 300, toAmount: 300 }), { d1: -300 });
});

test("reversing a transfer undoes it exactly", () => {
  const t = { type: "transfer", fromId: "debt:d1", toId: "acc", fromAmount: 1400, toAmount: 1400 };
  const applied = shiftDebt(dats, debtDeltas(t)[`d1`]);
  const back = shiftDebt(applied, debtDeltas(t, -1).d1);
  assert.deepEqual(back, dats);
});

test("expenses and income never touch a debt", () => {
  assert.deepEqual(debtDeltas({ type: "expense", fromId: "debt:d1", fromAmount: 5 }), {});
  assert.deepEqual(debtDeltas({ type: "income", toId: "debt:d1", toAmount: 5 }), {});
});

test("a debt side snapshots like an EGP account, so history stays readable", () => {
  const sides = [{ id: "acc", name: "CIB", unit: "EGP" }, debtSide(dats)];
  const t = snapshotSides({ type: "transfer", fromId: "acc", toId: "debt:d1", fromAmount: 50, toAmount: 50 }, sides, {});
  assert.equal(t.toName, "DATS");
  assert.equal(t.toRate, 1);
  assert.equal(sideName(t, "to", []), "DATS", "still named after the debt is settled");
  assert.equal(findAcc([{ id: "d1", name: "Some account" }], t.toId), undefined);
});
