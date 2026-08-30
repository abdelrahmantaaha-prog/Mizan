/* Merchant memory decides what gets logged with one tap, so the interesting
   cases are the ones where it must refuse: a word it has only seen twice, a
   word that means two different things, and an account that has since been
   deleted. A memory that guesses confidently and wrongly is worse than none,
   because the whole point is that the user stops reading the proposal. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMemory, recall, applyMemory, instantMatch, readAmount, tokenize, normalize } from "../src/lib/memory.js";

const NOW = Date.parse("2026-08-28T00:00:00Z");
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString().slice(0, 10);

const tx = (over = {}) => ({
  id: Math.random().toString(36).slice(2),
  type: "expense",
  fromId: "cash",
  toId: null,
  fromAmount: 70,
  toAmount: 0,
  category: "Transport",
  subcategory: "Taxi/Uber",
  note: "uber to work",
  date: daysAgo(3),
  ...over,
});

const accs = [
  { id: "cash", name: "Cash", unit: "EGP", assetClass: "Cash" },
  { id: "card", name: "Bank card", unit: "EGP", assetClass: "Cash" },
];

test("recalls the category and account of a repeated merchant", () => {
  const mem = buildMemory([tx(), tx(), tx()], NOW);
  const hit = recall(mem, "uber home");
  assert.equal(hit.category, "Transport");
  assert.equal(hit.subcategory, "Taxi/Uber");
  assert.equal(hit.fromId, "cash");
  assert.equal(hit.amount, 70);
});

test("one sighting is not a habit", () => {
  const mem = buildMemory([tx()], NOW);
  assert.equal(recall(mem, "uber home"), null);
});

test("a word that means two things equally answers nothing", () => {
  // "market" split down the middle between food and household: no clear winner
  const rows = [
    ...Array.from({ length: 4 }, () => tx({ note: "market run", category: "Food", subcategory: "Groceries" })),
    ...Array.from({ length: 4 }, () => tx({ note: "market run", category: "Housing", subcategory: "Household" })),
  ];
  const mem = buildMemory(rows, NOW);
  assert.equal(recall(mem, "market run"), null);
});

test("recent behaviour outvotes old behaviour", () => {
  // paid cash all last year, moved to the card two months ago
  const rows = [
    ...Array.from({ length: 6 }, (_, i) => tx({ fromId: "cash", date: daysAgo(300 + i) })),
    ...Array.from({ length: 4 }, (_, i) => tx({ fromId: "card", date: daysAgo(20 + i) })),
  ];
  const hit = recall(buildMemory(rows, NOW), "uber");
  assert.equal(hit.fromId, "card");
});

test("the typical amount is a median, not a mean", () => {
  const rows = [tx({ fromAmount: 70 }), tx({ fromAmount: 70 }), tx({ fromAmount: 80 }), tx({ fromAmount: 4000 })];
  assert.equal(recall(buildMemory(rows, NOW), "uber").amount, 75);
});

test("applyMemory fills blanks but never overwrites a stated field", () => {
  const mem = buildMemory([tx(), tx(), tx()], NOW);
  const filled = applyMemory(mem, { type: "expense", note: "uber", category: "", subcategory: "", fromId: null });
  assert.equal(filled.category, "Transport");
  assert.equal(filled.fromId, "cash");

  const stated = applyMemory(mem, { type: "expense", note: "uber", category: "Personal", subcategory: "", fromId: "card" });
  assert.equal(stated.category, "Personal", "an explicit category survives");
  assert.equal(stated.fromId, "card", "an explicit account survives");
});

test("memory of a deleted account is not offered for one-tap logging", () => {
  const mem = buildMemory([tx(), tx(), tx(), tx()], NOW);
  assert.ok(instantMatch(mem, "uber 90", accs), "matches while the account exists");
  assert.equal(instantMatch(mem, "uber 90", [{ id: "card", name: "Bank card" }]), null);
});

test("a bare repeat proposes the usual amount and flags that it did", () => {
  const mem = buildMemory([tx(), tx(), tx(), tx()], NOW);
  const m = instantMatch(mem, "uber", accs);
  assert.equal(m.txn.fromAmount, 70);
  assert.equal(m.usedTypical, true);

  const typed = instantMatch(mem, "uber 120", accs);
  assert.equal(typed.txn.fromAmount, 120);
  assert.equal(typed.usedTypical, false);
});

test("income remembers the receiving account, not a paying one", () => {
  const rows = Array.from({ length: 4 }, () =>
    tx({ type: "income", fromId: null, toId: "card", fromAmount: 0, toAmount: 95000, category: "Income", subcategory: "Salary", note: "monthly salary" })
  );
  const m = instantMatch(buildMemory(rows, NOW), "salary", accs);
  assert.equal(m.txn.type, "income");
  assert.equal(m.txn.toId, "card");
  assert.equal(m.txn.toAmount, 95000);
  assert.equal(m.txn.fromId, null);
});

test("Arabic spellings of the same word are one token", () => {
  assert.deepEqual(tokenize("أوبر"), tokenize("اوبر"));
  assert.equal(normalize("قهوة"), normalize("قهوه"));

  const rows = Array.from({ length: 4 }, (_, i) =>
    tx({ note: i % 2 ? "أوبر للشغل" : "اوبر للشغل" })
  );
  assert.ok(recall(buildMemory(rows, NOW), "اوبر"), "both spellings feed one habit");
});

test("readAmount handles thousands, commas and Arabic digits", () => {
  assert.equal(readAmount("salary 95k"), 95000);
  assert.equal(readAmount("rent 12,500"), 12500);
  assert.equal(readAmount("قهوة ٨٠"), 80);
  assert.equal(readAmount("no number here"), 0);
});
