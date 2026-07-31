/* The push path, against an in-memory store.

   This is where two devices can silently destroy each other's work, so the
   cases that matter are the racy ones: a concurrent writer bumping the
   revision mid-push, and a first-ever sync landing on an empty row. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { pushDocument, TooLarge, Conflict } from "../api/_sync-core.js";
import { emptyState, live, touch, tombstone, MAX_DOC_BYTES } from "../shared/model.js";

const NOW = Date.now();
const ago = (d) => NOW - d * 86400000;

/* Mirrors _db.js: insert only when absent, update only when the revision the
   caller merged against is still the current one. */
function memStore(initial = null) {
  const rows = new Map();
  if (initial) rows.set("u1", initial);
  const store = {
    calls: { get: 0, insert: 0, update: 0 },
    async get(id) {
      store.calls.get++;
      const r = rows.get(id);
      return r ? { rev: r.rev, doc: r.doc } : null;
    },
    async insert(id, email, doc, bytes) {
      store.calls.insert++;
      if (rows.has(id)) return { inserted: false };
      rows.set(id, { rev: 1, doc, bytes });
      return { rev: 1, inserted: true };
    },
    async update(id, email, doc, bytes, expectedRev) {
      store.calls.update++;
      const cur = rows.get(id);
      if (!cur || cur.rev !== expectedRev) return null; // compare-and-set failed
      cur.rev = expectedRev + 1;
      cur.doc = doc;
      return { rev: cur.rev };
    },
    peek: () => rows.get("u1"),
    forceBump: (doc) => {
      const cur = rows.get("u1");
      cur.rev += 1;
      if (doc) cur.doc = doc;
    },
  };
  return store;
}

const acct = (id, over = {}) => ({
  id, name: "acct-" + id, assetClass: "Cash", unit: "EGP", balance: 100, updatedAt: ago(2), ...over,
});
const docWith = (over) => ({ ...emptyState(), ...over });

test("a first sync creates the row at revision 1", async () => {
  const store = memStore();
  const out = await pushDocument(store, "u1", "a@b.c", docWith({ accounts: [acct("x")] }));
  assert.equal(out.rev, 1);
  assert.equal(live(out.doc, "accounts").length, 1);
  assert.equal(store.calls.insert, 1);
});

test("a later push merges with what the server already has", async () => {
  const server = docWith({ accounts: [acct("laptop", { updatedAt: ago(3) })] });
  const store = memStore({ rev: 4, doc: server });

  const phone = docWith({ accounts: [acct("phone", { updatedAt: ago(1) })] });
  const out = await pushDocument(store, "u1", null, phone);

  assert.equal(out.rev, 5, "revision advances");
  assert.deepEqual(live(out.doc, "accounts").map((a) => a.id).sort(), ["laptop", "phone"], "neither device's account is lost");
});

test("the server's newer edit beats the pushing device's stale copy", async () => {
  const server = docWith({ accounts: [acct("x", { balance: 900, updatedAt: ago(1) })] });
  const store = memStore({ rev: 2, doc: server });

  const stale = docWith({ accounts: [acct("x", { balance: 100, updatedAt: ago(6) })] });
  const out = await pushDocument(store, "u1", null, stale);
  assert.equal(out.doc.accounts[0].balance, 900);
});

test("a delete on the pushing device propagates to the server", async () => {
  const server = docWith({ accounts: [acct("x", { updatedAt: ago(5) })] });
  const store = memStore({ rev: 7, doc: server });

  const deleted = docWith({ accounts: [tombstone(acct("x"), ago(1))] });
  const out = await pushDocument(store, "u1", null, deleted);
  assert.equal(live(out.doc, "accounts").length, 0);
  assert.equal(store.peek().doc.accounts[0].deletedAt > 0, true, "the tombstone is persisted, not dropped");
});

test("a writer that slips in mid-push is retried, not clobbered", async () => {
  const store = memStore({ rev: 1, doc: docWith({ accounts: [acct("a", { updatedAt: ago(5) })] }) });

  // simulate another device committing between our read and our write
  const realUpdate = store.update;
  let attempts = 0;
  store.update = async (...args) => {
    attempts++;
    if (attempts === 1) {
      store.forceBump(docWith({ accounts: [acct("a", { updatedAt: ago(5) })], transactions: [{ id: "t-other", date: "2026-07-01", type: "expense", fromAmount: 5, updatedAt: ago(1) }] }));
      return null; // CAS miss
    }
    return realUpdate(...args);
  };

  const mine = docWith({ accounts: [acct("a", { updatedAt: ago(5) })], transactions: [{ id: "t-mine", date: "2026-07-02", type: "expense", fromAmount: 9, updatedAt: ago(1) }] });
  const out = await pushDocument(store, "u1", null, mine);

  assert.equal(attempts, 2, "it retried exactly once");
  assert.deepEqual(
    live(out.doc, "transactions").map((t) => t.id).sort(),
    ["t-mine", "t-other"],
    "the racing device's transaction survives alongside ours"
  );
});

test("a writer that never yields eventually reports a conflict", async () => {
  const store = memStore({ rev: 1, doc: emptyState() });
  store.update = async () => null; // every CAS fails
  await assert.rejects(() => pushDocument(store, "u1", null, emptyState()), Conflict);
});

test("an oversized document is refused before it reaches the database", async () => {
  const store = memStore();
  const huge = docWith({
    transactions: Array.from({ length: 40000 }, (_, i) => ({
      id: "t" + i, date: "2026-01-01", type: "expense", fromAmount: 1, note: "x".repeat(200), updatedAt: NOW,
    })),
  });
  assert.ok(JSON.stringify(huge).length > MAX_DOC_BYTES);
  await assert.rejects(() => pushDocument(store, "u1", null, huge), TooLarge);
  assert.equal(store.calls.insert, 0, "nothing was written");
});

test("junk in the body is rejected as a client error", async () => {
  const store = memStore();
  for (const junk of [null, undefined, "a string", 42, []]) {
    await assert.rejects(() => pushDocument(store, "u1", null, junk), (e) => e.status === 400);
  }
});

test("pushing the same document twice changes nothing but the revision", async () => {
  const store = memStore();
  const doc = docWith({ accounts: [acct("x")] });
  const first = await pushDocument(store, "u1", null, doc);
  const second = await pushDocument(store, "u1", null, first.doc);
  assert.deepEqual(second.doc, first.doc, "merge is idempotent across a round trip");
});
