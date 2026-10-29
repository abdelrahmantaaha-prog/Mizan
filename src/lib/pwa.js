/* Service-worker registration with an explicit update prompt.

   The app previously used autoUpdate, which swaps the running app for a new
   build without warning — mid-edit, a reload can drop what you were typing.
   Now a new version announces itself and waits for a tap. */

import { isNative } from "./native.js";

let applyUpdate = null;

export async function initPWA({ onNeedRefresh, onOfflineReady }) {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  // The Android app carries its files inside the APK and updates by installing
  // a new one; a worker there would only cache what is already on the device.
  if (isNative()) return;
  try {
    const { registerSW } = await import("virtual:pwa-register");
    applyUpdate = registerSW({
      immediate: true,
      onNeedRefresh: () => onNeedRefresh && onNeedRefresh(),
      onOfflineReady: () => onOfflineReady && onOfflineReady(),
      onRegisterError: (e) => console.warn("service worker registration failed", e),
    });
  } catch {
    // running without the PWA plugin (plain dev server) — nothing to register
  }
}

export function reloadWithUpdate() {
  if (applyUpdate) applyUpdate(true);
  else window.location.reload();
}

/* online/offline as a hook-friendly subscription */
export function subscribeOnline(cb) {
  const on = () => cb(true);
  const off = () => cb(false);
  window.addEventListener("online", on);
  window.addEventListener("offline", off);
  return () => {
    window.removeEventListener("online", on);
    window.removeEventListener("offline", off);
  };
}
