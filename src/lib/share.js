/* The page's half of the share target.

   The service worker parks whatever was shared in a cache and redirects here
   with ?shared=1. This reads it once, empties the cache, and hands back
   something quick-add can use directly.

   Why files are decoded here rather than in the worker: parse.js sends
   inline_data to the model, which wants base64 anyway, a PDF may need its text
   pulled out first, and the page is the one place doing that work is certainly
   not holding up a fetch handler.

   A share is only ever consumed once. Leaving it in the cache would mean the
   same receipt re-appearing every time the app is opened from the home screen,
   which is exactly the kind of ghost entry a finance app cannot have. */

import { readAttachment, MAX_FILES } from "./files.js";

const SHARE = "mizan-share-v1";
const META = "/__share_meta";
const MAX_AGE = 10 * 60 * 1000; // a share older than this was abandoned

export function hasShareFlag() {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).has("shared");
}

/* Drop ?shared=1 so a reload does not look like a second share. */
export function clearShareFlag() {
  if (typeof window === "undefined" || !window.history || !window.history.replaceState) return;
  const url = new URL(window.location.href);
  url.searchParams.delete("shared");
  window.history.replaceState({}, "", url.pathname + (url.search || "") + url.hash);
}

/* { text, files: [attachment] } — the shape QuickAdd works in — or null.

   Everything shared comes through, not just the first thing. Sharing four
   receipts at once is one gesture in the share sheet and used to become four
   trips through the app; the reason to take only the first was that quick-add
   could hold one attachment, and now it holds a stack. PDFs come through the
   same way: readAttachment decides whether the text can be pulled out here or
   the file has to go to a model. */
export async function takeShare() {
  if (typeof caches === "undefined") return null;
  let cache;
  try {
    cache = await caches.open(SHARE);
  } catch {
    return null;
  }

  const metaRes = await cache.match(META);
  if (!metaRes) return null;

  let meta;
  try {
    meta = await metaRes.json();
  } catch {
    await cache.delete(META);
    return null;
  }

  const files = Array.isArray(meta.files) ? meta.files : [];
  const drain = async () => {
    await cache.delete(META);
    await Promise.all(files.map((f) => cache.delete("/__share_file_" + f.index)));
  };

  if (meta.at && Date.now() - meta.at > MAX_AGE) {
    await drain();
    return null;
  }

  /* Sharing a page sends title + text + url separately; sharing a bank SMS
     sends one text. Joining them and letting the parser sort it out beats
     guessing which field a given app decided to use. */
  const text = [meta.title, meta.text, meta.url].map((s) => (s || "").trim()).filter(Boolean).join(" ").slice(0, 2000);

  const attachments = [];
  let skipped = 0;
  for (const f of files.slice(0, MAX_FILES)) {
    const res = await cache.match("/__share_file_" + f.index);
    if (!res) { skipped++; continue; }
    const blob = await res.blob();
    /* Blobs out of the cache can come back with the type stripped, so the
       name the share carried is what says what this is. */
    const named = new File([blob], f.name || "shared", { type: blob.type || f.type || "" });
    try {
      attachments.push(await readAttachment(named));
    } catch {
      skipped++;
    }
  }
  if (files.length > MAX_FILES) skipped += files.length - MAX_FILES;

  await drain();
  if (!text && !attachments.length) return null;
  return { text, files: attachments, skipped };
}
