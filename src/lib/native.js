/* The Android shell (Capacitor), and nothing else.

   The same build runs as the web app and inside the APK. Everything here
   no-ops on the web, and the plugins are loaded with a dynamic import so the
   web bundle does not grow for them.

   Iron rule, learned on Rhythm: never let a Capacitor plugin object pass
   through promise machinery — never return one from an async function and
   never await one. The plugin is a proxy that answers every property,
   including `.then`, with a native call that never settles, so an `await` on
   it hangs forever. Plugins are destructured out of the imported module and
   only their methods are awaited. */

export function isNative() {
  try {
    const cap = typeof window !== "undefined" ? window.Capacitor : null;
    if (cap && typeof cap.isNativePlatform === "function") return cap.isNativePlatform();
    return false;
  } catch {
    return false;
  }
}

/* An <a download> on a blob URL silently does nothing in an Android WebView,
   so natively the file is written to the app's cache and handed to the share
   sheet, from which it can go to Drive, Files, WhatsApp or anywhere.
   Returns "shared", "saved" (written, share cancelled) or throws. */
export async function saveFileNative(name, text, mime) {
  const { Filesystem, Directory, Encoding } = await import("@capacitor/filesystem");
  const { Share } = await import("@capacitor/share");
  // Cache needs no storage permission on any Android version; the share
  // sheet is how the file reaches somewhere permanent.
  const res = await Filesystem.writeFile({ path: name, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
  try {
    await Share.share({ title: name, url: res.uri, dialogTitle: /json/.test(mime) ? "Save your Mizan backup" : "Save " + name });
    return "shared";
  } catch {
    return "saved";
  }
}

/* The phone's Back button. Without this, Back closes the app from anywhere —
   including with an entry half typed into a dialog. Now it closes the open
   dialog first, then returns to Overview, and only from Overview leaves
   (minimised, not killed, so nothing is lost). */
export function onBackButton(handler) {
  if (!isNative()) return () => {};
  let sub = null;
  let gone = false;
  import("@capacitor/app").then(({ App }) => {
    const p = App.addListener("backButton", () => handler({ minimize: () => App.minimizeApp() }));
    // addListener returns a promise of the handle; keep the handle, not the plugin
    Promise.resolve(p).then((h) => { if (gone) h.remove(); else sub = h; });
  }).catch(() => {});
  return () => { gone = true; if (sub) sub.remove(); };
}
