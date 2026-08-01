/* Client half of account sync.

   Shape of the deal: the local document stays the source of truth for the UI
   and keeps working with no network and no account. Sync is a background
   reconciliation — pull, merge, adopt, push — that never blocks a render and
   never makes the user wait to log an expense.

   Sign-in goes through Auth.js's own endpoints with a real form POST rather
   than fetch, because the flow ends in a cross-origin redirect to Google that
   only a top-level navigation can complete. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mergeState, fingerprint, sameDoc } from "../../shared/model.js";

const API = {
  me: "/api/me",
  sync: "/api/sync",
  csrf: "/api/auth/csrf",
  signIn: "/api/auth/signin/google",
  signOut: "/api/auth/signout",
};

/* ---------- Auth.js handshake ---------- */
async function csrfToken() {
  const r = await fetch(API.csrf, { credentials: "same-origin" });
  if (!r.ok) throw new Error("csrf-failed");
  const j = await r.json();
  return j.csrfToken;
}

/* Auth.js expects a form POST carrying its CSRF token; the response is a 302
   to Google, so this has to be a top-level navigation, not fetch. */
async function postForm(action, fields) {
  const token = await csrfToken();
  const form = document.createElement("form");
  form.method = "POST";
  form.action = action;
  form.style.display = "none";
  const add = (name, value) => {
    const i = document.createElement("input");
    i.type = "hidden";
    i.name = name;
    i.value = value;
    form.appendChild(i);
  };
  add("csrfToken", token);
  add("callbackUrl", window.location.origin + window.location.pathname);
  Object.entries(fields || {}).forEach(([k, v]) => add(k, v));
  document.body.appendChild(form);
  form.submit();
}

export const signIn = () => postForm(API.signIn);
export const signOut = () => postForm(API.signOut);

/* ---------- transport ---------- */
async function pullDoc() {
  const r = await fetch(API.sync, { credentials: "same-origin", headers: { Accept: "application/json" } });
  if (r.status === 401) return { signedOut: true };
  if (!r.ok) throw new Error("pull-" + r.status);
  return r.json();
}

async function pushDoc(doc) {
  const r = await fetch(API.sync, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ doc }),
  });
  if (r.status === 401) return { signedOut: true };
  if (r.status === 413) throw new Error("doc-too-large");
  if (!r.ok) throw new Error("push-" + r.status);
  return r.json();
}

export async function disconnect() {
  const r = await fetch(API.sync, { method: "DELETE", credentials: "same-origin" });
  if (!r.ok) throw new Error("disconnect-failed");
  return r.json();
}

const PUSH_DEBOUNCE = 4000;

/* Never sync out from under someone who is mid-edit. A push replaces the
   document with the server's merged copy, and doing that while a dialog is
   open makes the app feel like it is fighting you. Modals carry role="dialog",
   so this is a reliable read of "the user is in the middle of something". */
function userIsEditing() {
  return typeof document !== "undefined" && !!document.querySelector('[role="dialog"]');
}

/* status: "unavailable" | "signed-out" | "idle" | "syncing" | "offline" | "error" */
export function useSync({ state, adopt, loaded }) {
  const [capability, setCapability] = useState({ checked: false, sync: false, auth: false, db: false });
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState("unavailable");
  const [lastSync, setLastSync] = useState(null);
  const [error, setError] = useState(null);

  // JSON of the document as the server last confirmed it. Comparing against
  // this is what stops adopt→push→adopt from looping forever.
  const settled = useRef(null);
  const rev = useRef(0);
  const busy = useRef(false);
  const timer = useRef(null);
  const deferred = useRef(false); // a sync was skipped because a dialog was open
  const stateRef = useRef(state);
  stateRef.current = state;

  /* one capability probe on boot: does this deployment even have sync? */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(API.me, { credentials: "same-origin" });
        if (!r.ok) throw new Error("me-" + r.status);
        const j = await r.json();
        if (cancelled) return;
        setCapability({ checked: true, sync: !!j.sync, auth: !!j.auth, db: !!j.db });
        setUser(j.user || null);
        setStatus(!j.sync ? "unavailable" : j.user ? "idle" : "signed-out");
      } catch {
        // no backend at all (plain `vite dev`, or the static build) — that is a
        // supported way to run Mizan, so this is not an error state
        if (!cancelled) setCapability({ checked: true, sync: false, auth: false, db: false });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const reconcile = useCallback(async (reason) => {
    if (!capability.sync || !user || busy.current) return;
    // a manual "Sync now" is an explicit request, so it overrides the guard
    if (reason !== "manual" && userIsEditing()) { deferred.current = true; return; }

    busy.current = true;
    deferred.current = false;
    setStatus("syncing");
    setError(null);
    try {
      const before = stateRef.current;

      // A pull first means a device that has been away adopts remote edits
      // before overwriting anything, even if the user never touches it.
      const remote = await pullDoc();
      if (remote.signedOut) {
        setUser(null);
        setStatus("signed-out");
        return;
      }

      const merged = remote.doc ? mergeState(remote.doc, before) : before;

      let serverDoc;
      // Push only when the merge actually adds something the server lacks.
      if (!remote.doc || !sameDoc(merged, remote.doc)) {
        const saved = await pushDoc(merged);
        if (saved.signedOut) { setUser(null); setStatus("signed-out"); return; }
        rev.current = saved.rev;
        serverDoc = saved.doc;
      } else {
        rev.current = remote.rev || 0;
        serverDoc = remote.doc;
      }

      // Whatever the server now holds is, by definition, settled.
      settled.current = fingerprint(serverDoc);

      /* The user may have logged something while the request was in flight.
         Adopting the server's copy blindly would throw that edit away, so fold
         the current state back in. The fingerprint above still reflects only
         what the server has, which means the change detector will notice the
         difference and push the straggler on the next tick. */
      const current = stateRef.current;
      const next = current === before ? serverDoc : mergeState(serverDoc, current);

      // Only touch React state when something genuinely differs. Replacing the
      // document with an identical copy re-renders the whole tree for nothing.
      if (!sameDoc(next, current)) adopt(next);

      setLastSync(Date.now());
      setStatus("idle");
    } catch (e) {
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      setStatus(offline ? "offline" : "error");
      setError(e.message === "doc-too-large" ? "Your data is too large to sync." : "Sync didn't complete — it'll retry.");
      if (reason !== "retry") console.warn("sync failed", e);
    } finally {
      busy.current = false;
    }
  }, [capability.sync, user, adopt]);

  /* first reconcile once local data has loaded and we know who we are */
  const primed = useRef(false);
  useEffect(() => {
    if (!loaded || !capability.sync || !user || primed.current) return;
    primed.current = true;
    reconcile("boot");
  }, [loaded, capability.sync, user, reconcile]);

  /* Local edits schedule a push; the debounce keeps a burst of typing to one.
     The comparison is by fingerprint, not raw JSON — see shared/model.js. */
  useEffect(() => {
    if (!loaded || !capability.sync || !user) return;
    if (settled.current === null || fingerprint(state) === settled.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => reconcile("local-change"), PUSH_DEBOUNCE);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [state, loaded, capability.sync, user, reconcile]);

  /* Anything skipped while a dialog was open runs once it closes, so closing
     an edit form is what commits it rather than an arbitrary timer. */
  useEffect(() => {
    if (!capability.sync || !user) return;
    const id = setInterval(() => {
      if (deferred.current && !userIsEditing()) reconcile("resumed");
    }, 1500);
    return () => clearInterval(id);
  }, [capability.sync, user, reconcile]);

  /* coming back to the app, or back online, is when another device's edits
     are most likely to be waiting */
  useEffect(() => {
    if (!capability.sync || !user) return;
    const onFocus = () => { if (document.visibilityState === "visible") reconcile("focus"); };
    const onOnline = () => reconcile("retry");
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("online", onOnline);
    };
  }, [capability.sync, user, reconcile]);

  const stopSync = useCallback(async () => {
    await disconnect();
    settled.current = null;
    rev.current = 0;
    await signOut();
  }, []);

  return useMemo(
    () => ({ capability, user, status, lastSync, error, syncNow: () => reconcile("manual"), signIn, signOut, stopSync }),
    [capability, user, status, lastSync, error, reconcile, stopSync]
  );
}
