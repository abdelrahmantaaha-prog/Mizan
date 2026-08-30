/* Mizan's service worker.

   Written by hand rather than generated, because the app needs one thing a
   generated worker cannot do: accept a POST. The Web Share Target API delivers
   a shared receipt or a bank SMS to the app as a multipart POST to /share,
   and that request has to be answered by the worker — there is no server on
   the other end of a static deploy, and by the time the page loads the request
   body is gone.

   Workbox is deliberately not imported. Its runtime packages are only present
   here as transitive dependencies of the build tool, so importing them would
   make the bundle depend on npm's hoisting rather than on anything declared.
   What is used instead is the one thing the plugin injects — the precache
   manifest — and about eighty lines of cache handling around it.

   Update behaviour matches what the app promises in App.jsx: a new worker
   waits, the page shows "new version ready", and only a tap swaps it. A silent
   reload can land mid-entry and lose what someone was typing. */

/* eslint-env serviceworker */

const MANIFEST = self.__WB_MANIFEST || [];

/* Cache name carries the build's identity, so a deploy gets a fresh cache and
   the old one is dropped on activate instead of accumulating forever. */
const BUILD = MANIFEST.map((e) => e.revision || e.url).join("|");
let hash = 0;
for (let i = 0; i < BUILD.length; i++) hash = ((hash << 5) - hash + BUILD.charCodeAt(i)) | 0;
const PRECACHE = "mizan-precache-" + (hash >>> 0).toString(36);
const FONTS = "mizan-fonts-v1";
const SHARE = "mizan-share-v1"; // holds an incoming share until the app reads it

const PRECACHE_URLS = MANIFEST.map((e) => e.url);

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PRECACHE);
      // one failed asset must not fail the whole install
      await Promise.all(
        PRECACHE_URLS.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch(() => {})
        )
      );
    })()
  );
  // no skipWaiting: the new build waits for the user's tap
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith("mizan-precache-") && k !== PRECACHE).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

/* virtual:pwa-register sends this when the user taps Reload */
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

/* ---------- share target ----------
   The payload is parked in the cache and the browser is sent on to the app
   with ?shared=1. The page picks it up (lib/share.js), empties the cache and
   drops it into quick-add. Files are stored as raw responses rather than
   base64 so nothing large is encoded twice. */
async function receiveShare(request) {
  try {
    const form = await request.formData();
    const cache = await caches.open(SHARE);

    const files = form.getAll("media").filter((f) => f && typeof f !== "string" && f.size);
    for (let i = 0; i < files.length; i++) {
      await cache.put(
        new Request("/__share_file_" + i),
        new Response(files[i], { headers: { "Content-Type": files[i].type || "application/octet-stream" } })
      );
    }

    const meta = {
      title: String(form.get("title") || ""),
      text: String(form.get("text") || ""),
      url: String(form.get("url") || ""),
      files: files.map((f, i) => ({ index: i, name: f.name || "shared-" + i, type: f.type || "" })),
      at: Date.now(),
    };
    await cache.put(
      new Request("/__share_meta"),
      new Response(JSON.stringify(meta), { headers: { "Content-Type": "application/json" } })
    );
  } catch {
    // a share we cannot read should still open the app rather than erroring
  }
  return Response.redirect("/?shared=1", 303);
}

/* ---------- fetch ---------- */
const isFont = (url) =>
  url.origin === "https://fonts.googleapis.com" || url.origin === "https://fonts.gstatic.com";

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method === "POST" && url.origin === self.location.origin && url.pathname === "/share") {
    event.respondWith(receiveShare(request));
    return;
  }

  if (request.method !== "GET") return;

  // never answer an API call from cache: a stale session or a stale synced
  // document is worse than a failed request
  if (url.origin === self.location.origin && url.pathname.startsWith("/api/")) return;

  // fonts: serve from cache, refresh in the background
  if (isFont(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(FONTS);
        const hit = await cache.match(request);
        const net = fetch(request)
          .then((res) => {
            if (res && (res.ok || res.type === "opaque")) cache.put(request, res.clone());
            return res;
          })
          .catch(() => hit);
        return hit || net;
      })()
    );
    return;
  }

  // navigations: network first so a deploy is picked up, shell from cache offline
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const cache = await caches.open(PRECACHE);
          return (await cache.match("/index.html")) || (await cache.match("/")) || Response.error();
        }
      })()
    );
    return;
  }

  // precached assets are content-hashed, so cache-first is safe and instant
  if (url.origin === self.location.origin) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(PRECACHE);
        const hit = await cache.match(request, { ignoreSearch: false });
        if (hit) return hit;
        try {
          return await fetch(request);
        } catch {
          return (await cache.match("/index.html")) || Response.error();
        }
      })()
    );
  }
});
