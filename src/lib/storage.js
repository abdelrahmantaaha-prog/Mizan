/* Storage adapter. Prefers the Claude artifact key-value store when present
   (window.storage), falls back to localStorage on the open web, and to an
   in-memory map if both are unavailable (private browsing edge cases). */

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
  const s = JSON.stringify(value);
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
    mem[key] = value;
  }
}
