/* Regression: the sync loop.

   The client asked "did anything change?" with JSON.stringify. The server
   builds the merged document with keys in one order and migrate() rebuilds it
   in another, so identical data compared unequal — and the client pushed,
   adopted, compared, and pushed again, every few seconds, forever. It made the
   app feel like it was fighting the user mid-edit.

   fingerprint() has to be blind to key order for that never to recur. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { fingerprint, sameDoc, mergeState, migrate, prune, emptyState, touch } from "../shared/model.js";

const NOW = Date.now();
const acct = (id, over = {}) => ({
  id, name: "acct-" + id, assetClass: "Cash", unit: "EGP", balance: 100, updatedAt: NOW - 86400000, ...over,
});

test("fingerprint ignores key order", () => {
  assert.equal(fingerprint({ a: 1, b: 2 }), fingerprint({ b: 2, a: 1 }));
  assert.equal(fingerprint({ x: { p: 1, q: 2 } }), fingerprint({ x: { q: 2, p: 1 } }));
});

test("fingerprint still respects array order — reordering a ledger is a real change", () => {
  assert.notEqual(fingerprint([1, 2]), fingerprint([2, 1]));
});

test("fingerprint ignores undefined properties", () => {
  // an undone delete sets deletedAt: undefined, which JSON drops on the wire;
  // the local copy must not therefore look different from the server's
  assert.equal(fingerprint({ a: 1, deletedAt: undefined }), fingerprint({ a: 1 }));
});

test("fingerprint distinguishes real differences", () => {
  assert.notEqual(fingerprint({ a: 1 }), fingerprint({ a: 2 }));
  assert.notEqual(fingerprint({ a: 1 }), fingerprint({ a: "1" }));
  assert.notEqual(fingerprint({ a: null }), fingerprint({ a: 0 }));
});

test("a server round trip is a no-op — this is the loop that must not come back", () => {
  const local = { ...emptyState(), accounts: [acct("a")] };

  const fromServer = mergeState(local, local); // what POST /api/sync returns
  const afterAdopt = prune(migrate(fromServer)); // what the client stores

  assert.notEqual(
    JSON.stringify(fromServer),
    JSON.stringify(afterAdopt),
    "key order really does differ — if this ever stops being true the bug is masked, not fixed"
  );
  assert.ok(sameDoc(fromServer, afterAdopt), "but the documents are the same, so no further push is scheduled");
});

test("a second round trip is stable too", () => {
  const local = { ...emptyState(), accounts: [acct("a")], transactions: [{ id: "t", date: "2026-07-01", type: "expense", fromAmount: 5, updatedAt: NOW }] };
  const one = prune(migrate(mergeState(local, local)));
  const two = prune(migrate(mergeState(one, one)));
  assert.ok(sameDoc(one, two), "syncing repeatedly must converge, not oscillate");
});

test("a genuine local edit is still detected after a round trip", () => {
  const local = { ...emptyState(), accounts: [acct("a")] };
  const settled = prune(migrate(mergeState(local, local)));
  const edited = { ...settled, accounts: [touch({ ...settled.accounts[0], balance: 999 })] };
  assert.ok(!sameDoc(settled, edited), "an actual change must still schedule a push");
});
