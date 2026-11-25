/* Storage adapter. Prefers the Claude artifact key-value store when present
   (window.storage), falls back to localStorage on the open web, and to an
   in-memory map if both are unavailable (private browsing edge cases).

   Writes are debounced. The app persists on every state change, and the state
   is one JSON document containing every account and transaction — serialising
   and writing it synchronously on each keystroke-driven update janks the main
   thread once the history gets long. Debouncing coalesces a burst into one
   write, and a flush on pagehide/visibilitychange makes sure nothing is lost
   when the tab is closed or backgrounded mid-burst. */

const mem = {};

function hasArtifactStorage() {
  return typeof window !== "undefined" && window.storage && typeof window.storage.get === "function";
}

export async function loadKey(key) {
  if (hasArtifactStorage()) {
    try {
      const r = await window.storage.get(key);
      return r ? JSON.parse(r.value) : null;
    } catch {
      return null;
    }
  }
  try {
    const v = window.localStorage.getItem(key);
    return v ? JSON.parse(v) : null;
  } catch {
    return key in mem ? mem[key] : null;
  }
}

export async function saveKey(key, value) {
  let s;
  try {
    s = JSON.stringify(value);
  } catch (e) {
    console.error("serialise failed", key, e);
    return;
  }
  if (hasArtifactStorage()) {
    try {
      await window.storage.set(key, s);
      return;
    } catch (e) {
      console.error("save failed", e);
      return;
    }
  }
  try {
    window.localStorage.setItem(key, s);
  } catch {
    // quota exceeded or storage disabled — keep the session alive in memory
    mem[key] = value;
  }
}

/* ---------- debounced writes ---------- */
const pending = new Map(); // key -> value
let timer = null;
let listening = false;

function flushNow() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!pending.size) return;
  const batch = [...pending.entries()];
  pending.clear();
  for (const [key, value] of batch) saveKey(key, value);
}

/* flush synchronously enough to survive a tab close; both events fire before
   unload on the browsers that matter, and neither is reliable alone */
function ensureListeners() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("pagehide", flushNow);
  window.addEventListener("beforeunload", flushNow);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushNow();
  });
}

export function saveKeyDebounced(key, value, ms = 400) {
  ensureListeners();
  pending.set(key, value);
  if (timer) clearTimeout(timer);
  timer = setTimeout(flushNow, ms);
}
