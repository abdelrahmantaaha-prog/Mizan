/* Merge and migration are the two places where a quiet bug destroys real data:
   one loses an edit made on another device, the other crashes a tab on a
   backup that is merely incomplete. Both are pure functions, so both are
   cheap to pin down. Run with: npm test */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeState, migrate, emptyState, prune, touch, tombstone, live, touchScalar,
  SCHEMA_VERSION, TOMBSTONE_TTL_DAYS,
} from "../shared/model.js";

/* Timestamps have to be realistic: mergeState prunes tombstones older than
   TOMBSTONE_TTL_DAYS, so a record stamped near the epoch is legitimately
   swept away and would make these tests lie. */
const NOW = Date.now();
const ago = (days) => NOW - days * 86400000;

const acct = (id, over = {}) => ({
  id, name: "acct-" + id, assetClass: "Cash", unit: "EGP", balance: 100, updatedAt: ago(10), ...over,
});

const docWith = (over = {}) => ({ ...emptyState(), ...over });

test("merge keeps the newer version of a record", () => {
  const a = docWith({ accounts: [acct("x", { balance: 100, updatedAt: ago(5) })] });
  const b = docWith({ accounts: [acct("x", { balance: 250, updatedAt: ago(1) })] });
  assert.equal(mergeState(a, b).accounts[0].balance, 250);
  assert.equal(mergeState(b, a).accounts[0].balance, 250, "order must not matter");
});

test("merge is symmetric and idempotent", () => {
  const a = docWith({ accounts: [acct("x", { updatedAt: ago(1) })], transactions: [{ id: "t1", date: "2026-01-01", type: "expense", fromAmount: 10, updatedAt: ago(5) }] });
  const b = docWith({ accounts: [acct("y", { updatedAt: ago(2) })] });

  const ab = mergeState(a, b);
  const ba = mergeState(b, a);
  assert.deepEqual(
    ab.accounts.map((x) => x.id).sort(),
    ba.accounts.map((x) => x.id).sort()
  );
  assert.deepEqual(mergeState(ab, ab), ab, "merging a document with itself must change nothing");
});

test("merge unions records only one side has", () => {
  const a = docWith({ accounts: [acct("x")] });
  const b = docWith({ accounts: [acct("y")] });
  assert.deepEqual(mergeState(a, b).accounts.map((r) => r.id).sort(), ["x", "y"]);
});

test("a delete propagates instead of being resurrected", () => {
  // the device that deleted has the newer timestamp; the other still has the row
  const deleted = docWith({ accounts: [tombstone(acct("x"), ago(1))] });
  const stale = docWith({ accounts: [acct("x", { updatedAt: ago(9) })] });
  const merged = mergeState(stale, deleted);
  assert.equal(merged.accounts.length, 1, "the tombstone itself is kept");
  assert.ok(merged.accounts[0].deletedAt, "row stays deleted");
  assert.equal(live(merged, "accounts").length, 0, "and is invisible to the UI");
});

test("an edit newer than a delete brings the record back", () => {
  const deleted = docWith({ accounts: [tombstone(acct("x"), ago(9))] });
  const edited = docWith({ accounts: [acct("x", { balance: 999, updatedAt: ago(1) })] });
  const merged = mergeState(deleted, edited);
  assert.equal(live(merged, "accounts").length, 1);
  assert.equal(merged.accounts[0].balance, 999);
});

test("a delete wins a same-millisecond tie, both ways round", () => {
  const t = ago(1);
  const del = docWith({ accounts: [tombstone(acct("x"), t)] });
  const edit = docWith({ accounts: [acct("x", { balance: 1, updatedAt: t })] });
  assert.ok(mergeState(del, edit).accounts[0].deletedAt);
  assert.ok(mergeState(edit, del).accounts[0].deletedAt);
});

test("scalar maps merge by their own timestamp, not by shape", () => {
  const older = touchScalar(emptyState(), "targets", { Gold: 10, Cash: 90 }, ago(5));
  const newer = touchScalar(emptyState(), "targets", { Gold: 50, Cash: 50 }, ago(1));
  // migrate() backfills every liquid class, so the merged map is complete —
  // that is what lets the Prices tab read state.targets[c] without a guard
  const expected = { "Money market": 0, Gold: 50, Equity: 0, Cash: 50 };
  assert.deepEqual(mergeState(older, newer).targets, expected);
  assert.deepEqual(mergeState(newer, older).targets, expected);
});

test("day series are deduplicated by date and stay ordered", () => {
  const a = docWith({ history: [{ d: "2026-01-02", net: 10, updatedAt: ago(5) }, { d: "2026-01-01", net: 5, updatedAt: ago(5) }] });
  const b = docWith({ history: [{ d: "2026-01-02", net: 99, updatedAt: ago(1) }] });
  const h = mergeState(a, b).history;
  assert.equal(h.length, 2);
  assert.deepEqual(h.map((x) => x.d), ["2026-01-01", "2026-01-02"]);
  assert.equal(h[1].net, 99);
});

test("prune drops expired tombstones but keeps recent ones", () => {
  const now = Date.now();
  const old = { ...acct("old"), deletedAt: 1, updatedAt: now - (TOMBSTONE_TTL_DAYS + 5) * 86400000 };
  const fresh = { ...acct("fresh"), deletedAt: 1, updatedAt: now - 86400000 };
  const pruned = prune(docWith({ accounts: [old, fresh] }), now);
  assert.deepEqual(pruned.accounts.map((a) => a.id), ["fresh"]);
});

test("migrate fills every collection a partial backup omits", () => {
  // this is the shape that used to crash the Prices tab: accounts only
  const partial = { accounts: [{ id: "a", name: "Cash", assetClass: "Cash", unit: "EGP", balance: 5 }] };
  const m = migrate(partial);
  assert.equal(m.v, SCHEMA_VERSION);
  assert.deepEqual(m.transactions, []);
  assert.deepEqual(m.debts, []);
  assert.deepEqual(m.recurring, []);
  assert.equal(typeof m.targets, "object");
  assert.equal(m.targets.Gold, 0, "targets must be readable without a guard");
  assert.equal(typeof m.budgets, "object");
  assert.equal(m.zakat.standard, "silver");
  assert.ok(m.accounts[0].updatedAt, "v1 records get stamped so they can merge");
});

test("migrate folds the v1 standalone history key into the document", () => {
  const m = migrate({ accounts: [] }, { history: [{ d: "2026-01-01", net: 42 }] });
  assert.equal(m.history.length, 1);
  assert.equal(m.history[0].net, 42);
  assert.ok(m.history[0].updatedAt);
});

test("migrate survives junk without throwing", () => {
  for (const junk of [null, undefined, 42, "nope", [], { accounts: "not-an-array" }]) {
    const m = migrate(junk);
    assert.ok(Array.isArray(m.accounts));
    assert.ok(Array.isArray(m.transactions));
  }
});

test("migrate coerces hand-edited numbers", () => {
  const m = migrate({ accounts: [{ id: "a", balance: "1,0", assetClass: "Nonsense", unit: "EGP" }] });
  assert.equal(m.accounts[0].balance, 0, "an unparseable balance must not become NaN");
  assert.equal(m.accounts[0].assetClass, "Cash", "an unknown class falls back rather than vanishing from every total");
});

test("touch stamps, tombstone hides", () => {
  const t = touch(acct("z"), 555);
  assert.equal(t.updatedAt, 555);
  const d = tombstone(t, 666);
  assert.equal(d.deletedAt, 666);
  assert.equal(live({ accounts: [d] }, "accounts").length, 0);
});
