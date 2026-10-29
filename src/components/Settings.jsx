/* Settings: account sync, AI key, appearance, backup, reset. */

import React, { useRef, useState } from "react";
import { ArrowLeft, KeyRound, Cloud, Download, Upload, FileSpreadsheet, Send } from "lucide-react";
import { Card, CardTitle, Field, ConfirmButton, Segmented, inputCls, useToast } from "./ui.jsx";
import { aiProviderName, testGeminiKey, DEFAULT_GEMINI_MODEL, GEMINI_MODELS } from "../lib/ai.js";
import { isNative } from "../lib/native.js";
import { exportBackupFile, exportTransactionsCsv, exportAccountsCsv, readFile } from "../lib/exportImport.js";
import { egpValue } from "../lib/valuation.js";
import { migrate, emptyState, live } from "../../shared/model.js";
import { timeAgo } from "../lib/format.js";
import { createLink, unlinkTelegram } from "../lib/inbox.js";
import { ACCENT, DISPLAY_FONT, MONO_FONT, TEAL, AMBER } from "../theme.js";

/* ---------- account sync ---------- */
function SyncCard({ sync }) {
  const [busy, setBusy] = useState(false);
  if (!sync || !sync.capability.checked) return null;

  if (!sync.capability.sync) {
    return (
      <Card>
        <span className="inline-flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg" style={{ background: "var(--sub2)", color: "var(--muted)" }}>
            <Cloud size={15} strokeWidth={2} />
          </span>
          <CardTitle>Account sync</CardTitle>
        </span>
        {isNative() ? (
          <p className="text-[12px] mz-tx2 mt-2 leading-relaxed">
            The Android app keeps everything on this phone. To move your data to or from another device, save a backup below and restore it there.
          </p>
        ) : (
          <>
            <p className="text-[12px] mz-tx2 mt-2 leading-relaxed">
              Not available on this deployment. Mizan keeps everything on this device, which works — but backups are the only way to move data.
              {sync.capability.auth && !sync.capability.db && " (Sign-in is configured, but no database is connected.)"}
              {!sync.capability.auth && sync.capability.db && " (A database is connected, but Google sign-in isn't configured.)"}
            </p>
            <p className="text-[11px] mz-tx3 mt-2 font-mono">to enable: set AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET and DATABASE_URL</p>
          </>
        )}
      </Card>
    );
  }

  const { user, status, lastSync, error } = sync;

  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg shrink-0" style={{ background: ACCENT + "1F", color: ACCENT }}>
            <Cloud size={15} strokeWidth={2} />
          </span>
          <CardTitle>Account sync</CardTitle>
        </span>
        <span className="text-[10px] uppercase tracking-widest font-mono shrink-0" style={{ color: user ? TEAL : "var(--muted)" }}>
          {user ? status : "signed out"}
        </span>
      </div>

      {!user ? (
        <>
          <p className="text-[12px] mz-tx2 mt-2 leading-relaxed">
            Sign in with Google to keep accounts, transactions, budgets and history in step across your phone and laptop. Edits made on either device are merged
            record by record, so nothing gets overwritten just because one of them synced last.
          </p>
          <button
            onClick={() => { setBusy(true); sync.signIn().catch(() => setBusy(false)); }}
            disabled={busy}
            className="w-full mz-btn-primary text-sm font-medium py-2.5 rounded-lg mt-3"
          >
            {busy ? "opening Google…" : "Sign in with Google"}
          </button>
          <p className="text-[11px] mz-tx3 mt-2">
            Your Gemini API key and theme are never uploaded — they stay on this device.
          </p>
        </>
      ) : (
        <>
          <div className="flex items-center gap-3 mt-3">
            {user.image ? (
              <img src={user.image} alt="" width={36} height={36} className="rounded-full" referrerPolicy="no-referrer" />
            ) : (
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold" style={{ background: ACCENT + "1F", color: ACCENT }}>
                {(user.name || user.email || "?").slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{user.name || "Signed in"}</div>
              <div className="text-[11px] font-mono mz-tx3 truncate">{user.email}</div>
            </div>
          </div>

          <div className="text-[11px] font-mono mz-tx3 mt-2">
            last synced {lastSync ? timeAgo(lastSync) : "not yet"}
          </div>
          {error && <div className="mt-2 text-[11px] border mz-note-amber rounded-lg p-2" style={{ color: AMBER }}>{error}</div>}

          <div className="flex gap-2 mt-3">
            <button onClick={sync.syncNow} disabled={status === "syncing"} className="flex-1 mz-btn-primary text-sm font-medium py-2 rounded-lg">
              {status === "syncing" ? "syncing…" : "Sync now"}
            </button>
            <button onClick={() => sync.signOut()} className="px-4 text-sm mz-btn-ghost rounded-lg">Sign out</button>
          </div>

          <div className="mt-3 pt-3 border-t mz-bd">
            <ConfirmButton
              label="Stop syncing & delete the cloud copy"
              confirmLabel="Yes, delete the cloud copy"
              onConfirm={() => sync.stopSync()}
            />
            <p className="text-[11px] mz-tx3 mt-1">Removes the copy on the server and signs you out. The data on this device is untouched.</p>
          </div>
        </>
      )}
    </Card>
  );
}

/* ---------- Telegram capture ----------
   Linking is a code the user carries from here into a chat. It is short-lived
   and single-use because it is the one thing that crosses between an
   anonymous chat id and their account — see api/_inbox.js. */
function TelegramCard({ sync }) {
  const toast = useToast();
  const [code, setCode] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const tg = (sync && sync.capability && sync.capability.telegram) || {};
  if (!sync || !sync.capability.checked || !tg.available) return null;

  const signedIn = !!sync.user;

  async function link() {
    setBusy(true);
    setErr(null);
    try {
      setCode(await createLink());
    } catch {
      setErr("Couldn't get a code just now. Try again in a moment.");
    }
    setBusy(false);
  }

  async function unlink() {
    try {
      await unlinkTelegram();
      setCode(null);
      await sync.refresh();
      toast("Telegram disconnected");
    } catch {
      setErr("Couldn't disconnect. Try again.");
    }
  }

  const deepLink = code && code.bot ? `https://t.me/${code.bot}?start=${code.code}` : null;

  return (
    <Card>
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg" style={{ background: ACCENT + "1F", color: ACCENT }}>
            <Send size={15} strokeWidth={2} />
          </span>
          <CardTitle>Telegram capture</CardTitle>
        </span>
        {tg.linked && <span className="text-[10px] uppercase tracking-widest font-mono" style={{ color: TEAL }}>connected</span>}
      </div>

      <p className="text-[12px] mz-tx2 mt-2 leading-relaxed">
        Text the bot what you spent — "80 uber", or a photo of a receipt — without opening anything. It's held until you
        open Mizan, which reads it with your own key and shows it for confirmation. Nothing reaches your balances on its own.
      </p>

      {!signedIn ? (
        <p className="text-[11px] mz-tx3 mt-2">Sign in above first — the bot needs an account to deliver to.</p>
      ) : tg.linked ? (
        <div className="mt-3">
          <button onClick={unlink} className="text-xs font-mono px-3 py-1.5 rounded-lg mz-btn-ghost">disconnect</button>
          <p className="text-[11px] mz-tx3 mt-1">Or send /stop to the bot. Anything already waiting stays until you read it.</p>
        </div>
      ) : (
        <div className="mt-3">
          <button onClick={link} disabled={busy} className="mz-btn-primary text-sm font-medium px-4 py-2 rounded-lg">
            {busy ? "getting a code…" : "Connect Telegram"}
          </button>
          {code && (
            <div className="mt-3 rounded-xl border mz-note-blue p-3">
              <div className="text-[11px] font-mono uppercase tracking-widest mz-txblue">your code</div>
              <div className="font-mono text-lg tracking-[0.2em] mt-1">{code.code}</div>
              <p className="text-[11px] mz-tx2 mt-2">
                {deepLink ? "Open the bot and it links itself, or send " : "Send "}
                <span className="font-mono">/start {code.code}</span>
                {deepLink ? " by hand." : " to the bot."} Expires in {code.expiresInMinutes} minutes.
              </p>
              {deepLink && (
                <a href={deepLink} target="_blank" rel="noreferrer" className="inline-block mt-2 text-xs font-mono px-3 py-1.5 rounded-lg mz-btn-primary">
                  open @{code.bot}
                </a>
              )}
              <button onClick={() => sync.refresh()} className="ml-2 text-xs font-mono px-3 py-1.5 rounded-lg mz-btn-ghost">
                I've sent it
              </button>
            </div>
          )}
        </div>
      )}
      {err && <div className="mt-2 text-[11px] mz-txrose border mz-note-rose rounded-lg p-2">{err}</div>}
    </Card>
  );
}

export default function SettingsPage({
  settings, setSettings, state, setState, prices, setPrices, theme, setTheme, onBack, sync,
}) {
  const toast = useToast();
  const [keyDraft, setKeyDraft] = useState(settings.geminiKey || "");
  const [poolUrl, setPoolUrl] = useState(settings.brokerUrl || "");
  const [poolToken, setPoolToken] = useState(settings.brokerToken || "");
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState(null);
  const [dataMsg, setDataMsg] = useState(null);
  const [restoreText, setRestoreText] = useState("");
  const fileRef = useRef(null);

  const inArtifact = typeof window !== "undefined" && window.storage && typeof window.storage.get === "function";
  const provider = aiProviderName(settings);

  function saveAI() {
    setSettings((s) => ({
      ...s,
      geminiKey: keyDraft.trim(),
      brokerUrl: poolUrl.trim(),
      brokerToken: poolToken.trim(),
    }));
    toast(
      poolUrl.trim() && poolToken.trim()
        ? "Saved — AI features use the shared key pool, your key is the fallback"
        : keyDraft.trim()
          ? "Gemini key saved — AI features now use Gemini"
          : "Gemini key removed"
    );
    setTestMsg(null);
  }

  async function runTest() {
    setTesting(true);
    setTestMsg(null);
    const r = await testGeminiKey(keyDraft.trim(), settings.geminiModel);
    setTestMsg(r.ok ? { ok: true, text: "Key works — answered by " + (r.model || "Gemini") + "." } : { ok: false, text: "Key check failed: " + r.error });
    setTesting(false);
  }

  function applyRestore(raw) {
    try {
      const p = JSON.parse(raw.trim());
      const incoming = p.state || p;
      if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.accounts)) throw new Error("shape");
      // Everything goes through migrate(), so a backup missing budgets, targets
      // or debts fills its gaps instead of crashing a tab later.
      const next = migrate(incoming, { history: p.history });
      setState(next);
      if (p.prices && p.prices.gold24) setPrices(p.prices);
      setRestoreText("");
      setDataMsg(
        `Restored ${live(next, "accounts").length} accounts and ${live(next, "transactions").length} transactions.`
      );
    } catch {
      setDataMsg("That doesn't look like a valid Mizan backup. Use the .json file you exported, or paste its full contents.");
    }
  }

  async function onPickFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      applyRestore(await readFile(file));
    } catch {
      setDataMsg("Couldn't read that file.");
    }
    e.target.value = "";
  }

  function reset() {
    const fresh = emptyState();
    setState(fresh);
    toast("Everything erased — clean slate");
  }

  return (
    <div className="max-w-3xl mx-auto px-4 pb-16 pt-6">
      <div className="flex items-center gap-1 mb-4">
        <button onClick={onBack} aria-label="Back" className="mz-iconbtn mz-tx2 -ml-2"><ArrowLeft size={18} strokeWidth={2} /></button>
        <h1 className="text-xl tracking-tight mz-tx1" style={{ fontFamily: DISPLAY_FONT, fontWeight: 700 }}>Settings</h1>
      </div>

      <div className="mz-tabview space-y-3">
        <SyncCard sync={sync} />
        <TelegramCard sync={sync} />

        <Card>
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg" style={{ background: ACCENT + "1F", color: ACCENT }}>
                <KeyRound size={15} strokeWidth={2} />
              </span>
              <CardTitle>AI features</CardTitle>
            </span>
            <span className="text-[10px] uppercase tracking-widest font-mono" style={{ color: provider === "Gemini" ? TEAL : "var(--muted)" }}>
              using {provider}
            </span>
          </div>
          <p className="text-[12px] mz-tx2 mt-2 leading-relaxed">
            Quick-add parsing, receipt reading, balance sync and the "today (web)" price lookup are AI-powered.
            {inArtifact
              ? " Inside Claude.ai they work without any key. Add a Gemini key to use Google's models instead."
              : " On the web, add a free Google Gemini API key — get one at aistudio.google.com/apikey. Without a key, AI boxes fall back to the built-in offline parser."}
          </p>
          <div className="mt-3 space-y-2">
            <Field label="Gemini API key">
              <div className="flex gap-2">
                <input
                  type={showKey ? "text" : "password"}
                  className={inputCls + " font-mono"}
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  placeholder="AIza…"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button onClick={() => setShowKey((v) => !v)} className="px-3 text-[11px] font-mono mz-btn-ghost rounded-lg shrink-0">
                  {showKey ? "hide" : "show"}
                </button>
              </div>
            </Field>
            <Field label="Model" hint="Auto picks the newest Flash model your key supports and falls back automatically if Google retires one or a quota runs out.">
              <select className={inputCls} value={settings.geminiModel || DEFAULT_GEMINI_MODEL} onChange={(e) => setSettings((s) => ({ ...s, geminiModel: e.target.value }))}>
                {GEMINI_MODELS.map((m) => (
                  <option key={m} value={m}>{m === "auto" ? "auto — latest Flash (recommended)" : m}</option>
                ))}
              </select>
            </Field>
            <Field
              label="Shared key pool (optional)"
              hint="One address holding the keys every project in this folder rotates, with the cooldowns they have already found. Tried first; the key above answers when it cannot be reached."
            >
              <input
                className={inputCls + " font-mono"}
                value={poolUrl}
                onChange={(e) => setPoolUrl(e.target.value)}
                placeholder="https://keybroker.workers.dev"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            <Field label="Key pool token">
              <input
                type="password"
                className={inputCls + " font-mono"}
                value={poolToken}
                onChange={(e) => setPoolToken(e.target.value)}
                placeholder="kb_…"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            <div className="flex gap-2 pt-1">
              <button onClick={saveAI} className="flex-1 mz-btn-primary text-sm font-medium py-2 rounded-lg">Save</button>
              <button onClick={runTest} disabled={!keyDraft.trim() || testing} className="px-4 text-sm mz-btn-ghost rounded-lg disabled:opacity-40">
                {testing ? "testing…" : "Test key"}
              </button>
            </div>
            {testMsg && (
              <div className={"text-[11px] font-mono border rounded-lg p-2 " + (testMsg.ok ? "mz-note-teal mz-txteal" : "mz-note-rose mz-txrose")}>{testMsg.text}</div>
            )}
            <p className="text-[11px] mz-tx3">Your key is stored only in this browser and sent only to Google's API — never uploaded, not even when sync is on.</p>
          </div>
        </Card>

        <Card>
          <CardTitle>Appearance</CardTitle>
          <div className="mt-3">
            <Segmented options={[["light", "Light"], ["dark", "Dark"]]} value={theme} onChange={setTheme} />
          </div>
        </Card>

        <Card>
          <CardTitle>Backup &amp; export</CardTitle>
          <p className="text-[12px] mz-tx2 mt-1 leading-relaxed">
            A backup file holds everything: accounts, transactions, debts, budgets, targets and history. Keep one somewhere safe — clearing site data clears the app.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
            <button onClick={() => exportBackupFile(state, prices).then(
              (how) => setDataMsg(how === "downloaded" ? "Backup downloaded." : how === "shared" ? "Backup saved." : "Backup written to the app's files, but not shared anywhere yet."),
              () => setDataMsg("Could not save the backup."),
            )} className="mz-btn-primary text-sm font-medium py-2 rounded-lg inline-flex items-center justify-center gap-1.5">
              <Download size={15} strokeWidth={2} /> Backup (.json)
            </button>
            <button onClick={() => exportTransactionsCsv(state, prices).catch(() => setDataMsg("Could not save the file."))} className="text-sm font-medium py-2 rounded-lg mz-btn-ghost inline-flex items-center justify-center gap-1.5">
              <FileSpreadsheet size={15} strokeWidth={2} /> Transactions CSV
            </button>
            <button onClick={() => exportAccountsCsv(state, prices, egpValue).catch(() => setDataMsg("Could not save the file."))} className="text-sm font-medium py-2 rounded-lg mz-btn-ghost inline-flex items-center justify-center gap-1.5">
              <FileSpreadsheet size={15} strokeWidth={2} /> Accounts CSV
            </button>
          </div>
          <p className="text-[11px] mz-tx3 mt-2">
            CSV amounts are converted at the rate recorded when each transaction was logged, so the totals match what the app shows.
          </p>

          <div className="mt-4 pt-3 border-t mz-bd">
            <div className="text-[11px] uppercase tracking-wide mz-tx2 mb-2" style={{ fontFamily: MONO_FONT }}>Restore</div>
            <button onClick={() => fileRef.current && fileRef.current.click()} className="w-full text-sm font-medium py-2 rounded-lg mz-btn-ghost inline-flex items-center justify-center gap-1.5">
              <Upload size={15} strokeWidth={2} /> Choose a backup file
            </button>
            <input ref={fileRef} type="file" accept="application/json,.json,text/plain" className="hidden" onChange={onPickFile} />
            <details className="mt-2">
              <summary className="text-[11px] font-mono mz-tx3 cursor-pointer">or paste the backup text</summary>
              <textarea
                value={restoreText}
                onChange={(e) => setRestoreText(e.target.value)}
                rows={3}
                placeholder="paste your exported backup here"
                className="w-full mt-2 mz-input rounded-lg px-3 py-2 text-[11px] font-mono resize-none"
              />
              <button onClick={() => applyRestore(restoreText)} disabled={!restoreText.trim()} className="w-full mz-btn-primary text-sm font-medium py-2 rounded-lg mt-2 disabled:opacity-40">
                Restore from text
              </button>
            </details>
            <p className="text-[11px] mz-tx3 mt-2">
              Restoring replaces what's on this device. With sync on, the restored data merges into your account on the next sync.
            </p>
          </div>
          {dataMsg && <div className="mt-2 text-[11px] mz-tx2 border mz-note-mut rounded-lg p-2">{dataMsg}</div>}
        </Card>

        <Card>
          <CardTitle>Erase all data</CardTitle>
          <p className="text-[12px] mz-tx2 mt-1">
            Deletes every account, transaction and snapshot from this browser and starts over on a clean slate. Export a backup first if you might want anything back.
          </p>
          <div className="mt-2">
            <ConfirmButton label="Erase &amp; start fresh" confirmLabel="Yes, erase everything" onConfirm={reset} />
          </div>
        </Card>

        <div className="text-center text-[11px] mz-tx3 font-mono pt-2 pb-4">
          Mizan · ميزان — local first, sync optional
        </div>
      </div>
    </div>
  );
}
