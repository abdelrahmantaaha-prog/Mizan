/* The push algorithm, separated from both HTTP and Postgres.

   Kept apart so the part that can lose data — merge, compare-and-set, retry —
   can be tested against an in-memory store instead of only being exercised
   against a live database. `store` is the seam: { get, insert, update }, which
   _db.js implements over Neon. */

import { mergeState, migrate, docSize, MAX_DOC_BYTES } from "../shared/model.js";

export class TooLarge extends Error {
  constructor() { super("doc-too-large"); this.code = "doc-too-large"; this.status = 413; }
}
export class Conflict extends Error {
  constructor() { super("conflict-retry"); this.code = "conflict-retry"; this.status = 409; }
}

export const MAX_ATTEMPTS = 3;

/* Merge the client's document into the stored one and save it.

   Returns { rev, doc }. Throws Conflict if another writer kept winning the
   race — which in practice means the same user pushing from two devices in
   the same instant, and resolves on the client's next attempt. */
export async function pushDocument(store, userId, email, incoming, attempts = MAX_ATTEMPTS) {
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    const e = new Error("bad-doc");
    e.status = 400;
    e.code = "bad-doc";
    throw e;
  }
  if (docSize(incoming) > MAX_DOC_BYTES) throw new TooLarge();

  const clean = migrate(incoming);

  for (let i = 0; i < attempts; i++) {
    const row = await store.get(userId);

    if (!row) {
      const bytes = docSize(clean);
      const ins = await store.insert(userId, email, clean, bytes);
      if (ins && ins.inserted) return { rev: ins.rev, doc: clean };
      continue; // another writer inserted first — loop round and merge with it
    }

    const merged = mergeState(row.doc, clean);
    const bytes = docSize(merged);
    if (bytes > MAX_DOC_BYTES) throw new TooLarge();

    const saved = await store.update(userId, email, merged, bytes, row.rev);
    if (saved) return { rev: saved.rev, doc: merged };
    // update matched no row: the revision moved under us, so re-read and redo
  }

  throw new Conflict();
}
