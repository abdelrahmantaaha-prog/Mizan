/* Neon Postgres access for the sync endpoints.

   One row per user holding the whole Mizan document as jsonb, plus a revision
   counter. The counter is what makes concurrent writes safe: a push updates
   only when the revision it merged against is still current, so a second
   device that slipped in between is never silently overwritten — the loser
   re-reads and merges again.

   Neon's HTTP driver is used rather than a pooled TCP client because each
   Vercel function invocation is short-lived and may be cold; opening and
   tearing down a real connection per request costs more than the query. */

import { neon } from "@neondatabase/serverless";

let sql = null;
let schemaReady = null;

export function isConfigured() {
  return !!process.env.DATABASE_URL;
}

function client() {
  if (!isConfigured()) {
    const e = new Error("DATABASE_URL is not set");
    e.status = 503;
    e.code = "db-unconfigured";
    throw e;
  }
  if (!sql) sql = neon(process.env.DATABASE_URL);
  return sql;
}

/* Idempotent bootstrap, memoised per warm instance. Cheap enough to attempt on
   first use and removes a manual migration step from deployment. */
async function ensureSchema() {
  if (schemaReady) return schemaReady;
  const db = client();
  schemaReady = (async () => {
    await db`
      CREATE TABLE IF NOT EXISTS mizan_doc (
        user_id    text PRIMARY KEY,
        email      text,
        rev        bigint NOT NULL DEFAULT 1,
        doc        jsonb  NOT NULL,
        bytes      integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`;
    await db`CREATE INDEX IF NOT EXISTS mizan_doc_updated_idx ON mizan_doc (updated_at DESC)`;
  })().catch((e) => {
    schemaReady = null; // let the next request retry rather than wedging forever
    throw e;
  });
  return schemaReady;
}

export async function getDoc(userId) {
  await ensureSchema();
  const db = client();
  const rows = await db`SELECT rev, doc, updated_at FROM mizan_doc WHERE user_id = ${userId}`;
  if (!rows.length) return null;
  return { rev: Number(rows[0].rev), doc: rows[0].doc, updatedAt: rows[0].updated_at };
}

/* Create the row if this user has never synced. Returns the stored state. */
export async function insertDoc(userId, email, doc, bytes) {
  await ensureSchema();
  const db = client();
  const rows = await db`
    INSERT INTO mizan_doc (user_id, email, rev, doc, bytes)
    VALUES (${userId}, ${email || null}, 1, ${JSON.stringify(doc)}::jsonb, ${bytes})
    ON CONFLICT (user_id) DO NOTHING
    RETURNING rev`;
  return rows.length ? { rev: Number(rows[0].rev), inserted: true } : { inserted: false };
}

/* Compare-and-set. Returns null when someone else moved the revision on,
   which tells the caller to re-read and merge again. */
export async function updateDoc(userId, email, doc, bytes, expectedRev) {
  await ensureSchema();
  const db = client();
  const rows = await db`
    UPDATE mizan_doc
       SET doc = ${JSON.stringify(doc)}::jsonb,
           rev = rev + 1,
           bytes = ${bytes},
           email = COALESCE(${email || null}, email),
           updated_at = now()
     WHERE user_id = ${userId} AND rev = ${expectedRev}
     RETURNING rev, updated_at`;
  if (!rows.length) return null;
  return { rev: Number(rows[0].rev), updatedAt: rows[0].updated_at };
}

export async function deleteDoc(userId) {
  await ensureSchema();
  const db = client();
  await db`DELETE FROM mizan_doc WHERE user_id = ${userId}`;
}
