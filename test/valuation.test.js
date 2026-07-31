/* The historical-revaluation bug, pinned.

   Before the rate snapshot, a dollar expense logged when the pound was at 50
   was reported at whatever the pound is worth today — so last March's total
   changed every time prices refreshed. These tests fail if that behaviour
   comes back. */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  karatPrice, unitRate, rateFor, egpValue, snapshotSides,
  outEgp, inEgp, sideName, sideUnitLabel, findAcc,
} from "../src/lib/valuation.js";

const THEN = { gold24: 6000, usdEgp: 50 };
const NOW = { gold24: 9000, usdEgp: 75 };

const usdAcct = { id: "usd", name: "Dollar cash", unit: "USD", balance: 1000 };
const goldAcct = { id: "g", name: "Gold 21K", unit: "GOLD", karat: 21, balance: 10 };
const egpAcct = { id: "e", name: "Wallet", unit: "EGP", balance: 5000 };
const accounts = [usdAcct, goldAcct, egpAcct];

test("karat price scales from the 24K rate", () => {
  assert.equal(karatPrice(THEN, 24), 6000);
  assert.equal(karatPrice(THEN, 12), 3000);
  assert.equal(karatPrice({}, 24), 0, "a missing price must be 0, not NaN");
});

test("unit rates", () => {
  assert.equal(unitRate("USD", null, THEN), 50);
  assert.equal(unitRate("GOLD", 21, THEN), 5250);
  assert.equal(unitRate("EGP", null, THEN), 1);
});

test("a balance is valued at today's price — that part is meant to move", () => {
  assert.equal(egpValue(usdAcct, THEN), 50000);
  assert.equal(egpValue(usdAcct, NOW), 75000);
});

test("rateFor returns null for a missing account so callers can tell", () => {
  assert.equal(rateFor(undefined, NOW), null);
});

test("an expense keeps the rate it was logged at", () => {
  const raw = { id: "t", type: "expense", fromId: "usd", fromAmount: 100, date: "2026-03-01" };
  const stored = snapshotSides(raw, accounts, THEN);

  assert.equal(stored.fromRate, 50);
  assert.equal(stored.fromUnit, "USD");
  assert.equal(stored.fromName, "Dollar cash");

  // the whole point: today's rate must not change last March's number
  assert.equal(outEgp(stored, accounts, THEN), 5000);
  assert.equal(outEgp(stored, accounts, NOW), 5000);
});

test("a gold transfer keeps both legs' rates", () => {
  const raw = { id: "t2", type: "transfer", fromId: "e", toId: "g", fromAmount: 52500, toAmount: 10 };
  const stored = snapshotSides(raw, accounts, THEN);
  assert.equal(stored.fromRate, 1);
  assert.equal(stored.toRate, 5250);
  assert.equal(inEgp(stored, accounts, NOW), 52500, "the gram leg stays at the rate it was bought at");
});

test("legacy rows with no snapshot fall back to the live account", () => {
  const legacy = { id: "old", type: "expense", fromId: "usd", fromAmount: 100 };
  assert.equal(outEgp(legacy, accounts, THEN), 5000);
  assert.equal(outEgp(legacy, accounts, NOW), 7500);
});

test("a deleted account no longer collapses a dollar expense to 1:1", () => {
  const stored = snapshotSides({ id: "t3", type: "expense", fromId: "usd", fromAmount: 100 }, accounts, THEN);
  const orphaned = { ...stored };
  const without = accounts.filter((a) => a.id !== "usd");

  // the old code did rate(undefined) -> 1, turning $100 into EGP 100
  assert.equal(outEgp(orphaned, without, NOW), 5000);
  assert.equal(sideName(orphaned, "from", without), "Dollar cash", "the name survives the account");
  assert.equal(sideUnitLabel(orphaned, "from", without), "$");
});

test("an orphan with no snapshot at all still uses its remembered unit", () => {
  const halfLegacy = { id: "t4", type: "expense", fromId: "gone", fromAmount: 100, fromUnit: "USD" };
  assert.equal(outEgp(halfLegacy, [], NOW), 7500, "not 100");
  assert.equal(sideName(halfLegacy, "from", []), "removed account");
});

test("findAcc tolerates null ids", () => {
  assert.equal(findAcc(accounts, null), undefined);
  assert.equal(findAcc(undefined, "usd"), undefined);
});
