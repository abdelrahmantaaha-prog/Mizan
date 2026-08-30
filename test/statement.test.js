/* The sweep's only dangerous move is deciding a statement line is something
   you already logged. Get it wrong one way and the month double-counts; get it
   wrong the other and a real expense disappears into a "duplicate" the user
   never looks at. Hence: flag, never drop — and these pin the edges of what
   counts as the same transaction. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { markDuplicates, trimCsv } from "../src/lib/statement.js";

const ledger = (over = {}) => ({
  id: "t1", type: "expense", fromId: "card", toId: null,
  fromAmount: 250, toAmount: 250, date: "2026-08-10", note: "lunch", ...over,
});
const line = (over = {}) => ({
  type: "expense", fromId: "card", toId: null,
  fromAmount: 250, toAmount: 250, date: "2026-08-10", note: "SOME RESTAURANT", ...over,
});

test("same amount, same day is flagged", () => {
  const [row] = markDuplicates([line()], [ledger()]);
  assert.ok(row.dup);
  assert.equal(row.dup.id, "t1");
});

test("a bank posting a few days late is still the same transaction", () => {
  const [row] = markDuplicates([line({ date: "2026-08-12" })], [ledger()]);
  assert.ok(row.dup, "two days later still matches");
  const [far] = markDuplicates([line({ date: "2026-08-20" })], [ledger()]);
  assert.equal(far.dup, null, "ten days later is a different expense");
});

test("a different amount is a different transaction", () => {
  const [row] = markDuplicates([line({ fromAmount: 260 })], [ledger()]);
  assert.equal(row.dup, null);
});

test("rounding between a typed number and a printed one is tolerated", () => {
  const [row] = markDuplicates([line({ fromAmount: 250.25 })], [ledger({ fromAmount: 250 })]);
  assert.ok(row.dup);
});

test("income is never matched against an expense of the same size", () => {
  const [row] = markDuplicates([line({ type: "income", fromAmount: 0, toAmount: 250, toId: "card", fromId: null })], [ledger()]);
  assert.equal(row.dup, null);
});

test("one ledger row cannot explain two statement lines", () => {
  // two genuine 70 EGP rides on one day, but only one was logged by hand
  const rows = markDuplicates([line({ fromAmount: 70 }), line({ fromAmount: 70 })], [ledger({ fromAmount: 70 })]);
  assert.ok(rows[0].dup, "the first is matched");
  assert.equal(rows[1].dup, null, "the second survives as a real, unlogged expense");
});

test("deleted ledger rows do not shadow a statement line", () => {
  const [row] = markDuplicates([line()], [ledger({ deletedAt: Date.now() })]);
  assert.equal(row.dup, null);
});

test("nothing is ever removed — every input line comes back", () => {
  const input = [line(), line({ fromAmount: 99 }), line({ date: "2026-08-11" })];
  assert.equal(markDuplicates(input, [ledger()]).length, input.length);
});

test("trimCsv keeps the header and caps the rows", () => {
  const csv = ["date,desc,amount", ...Array.from({ length: 500 }, (_, i) => `2026-08-01,row ${i},10`)].join("\n");
  const out = trimCsv(csv, 100).split("\n");
  assert.equal(out.length, 101);
  assert.equal(out[0], "date,desc,amount");
});
