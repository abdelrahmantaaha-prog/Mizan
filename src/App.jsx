/* ============================================================
   MIZAN — ميزان
   A net-worth + activity tracker built for Egyptian holdings:
   native gold-by-karat accounts valued at live EGP spot, plus
   multi-currency cash and a liquid-only allocation ribbon.

   This file is the shell: state, persistence, derived totals and
   routing between tabs. Everything visible lives in components/,
   everything computed in lib/, and the data model itself in
   shared/ — which the sync server imports verbatim.
   ============================================================ */

import React, { useState, useEffect, useMemo, useRef, useCallback, Suspense, lazy } from "react";
import { Plus, RefreshCw } from "lucide-react";

import { loadKey, saveKey, saveKeyDebounced } from "./lib/storage.js";
import { aiComplete, DEFAULT_GEMINI_MODEL } from "./lib/ai.js";
import { fetchLivePrices, fetchWebPrices, recordPriceDay, SEED_PRICES } from "./lib/prices.js";
import { egpValue } from "./lib/valuation.js";
import { zakatStatus, nextHawlStart } from "./lib/zakat.js";
import { useSync } from "./lib/sync.js";
import { initPWA, reloadWithUpdate, subscribeOnline } from "./lib/pwa.js";
import {
  emptyState, migrate, live, touchScalar, prune,
  CLASS_ORDER, LIQUID_CLASSES, ILLIQUID_CLASS, HISTORY_LIMIT, uid,
} from "../shared/model.js";

import FontLoader from "./components/FontLoader.jsx";
import { ToastCtx, AICtx } from "./components/ui.jsx";
import Header from "./components/Header.jsx";
import NetWorthBlock from "./components/NetWorth.jsx";
import TabBar from "./components/TabBar.jsx";
import Overview from "./components/Overview.jsx";
import Accounts from "./components/Accounts.jsx";
import Activity from "./components/Activity.jsx";
import { INK, HAIRLINE, ACCENT, MONO_FONT, BODY_FONT } from "./theme.js";

/* Charts and the settings page are not needed to paint the first screen, so
   they load on demand — it keeps the initial bundle to the shell people
   actually open the app for. */
const Spending = lazy(() => import("./components/Spending.jsx"));
const PricesTab = lazy(() => import("./components/Prices.jsx"));
const SettingsPage = lazy(() => import("./components/Settings.jsx"));

const TabFallback = () => (
  <div className="space-y-3">
    <div className="mz-skel w-full" style={{ height: "9rem" }} />
    <div className="mz-skel w-full" style={{ height: "13rem" }} />
  </div>
);

export default function Mizan() {
  const [loaded, setLoaded] = useState(false);
  const [state, setState] = useState(emptyState);
  const [prices, setPrices] = useState(SEED_PRICES);
  const [theme, setTheme] = useState("light");
  const [settings, setSettings] = useState({ geminiKey: "", geminiModel: DEFAULT_GEMINI_MODEL });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tab, setTab] = useState("overview");
  const [fetching, setFetching] = useState(false);
  const [webBusy, setWebBusy] = useState(false);
  const [webErr, setWebErr] = useState(null);
  const [qaFocus, setQaFocus] = useState(0); // FAB → focus the quick-add box
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine !== false);
  const [updateReady, setUpdateReady] = useState(false);
  const didInit = useRef(false);

  const today = new Date().toISOString().slice(0, 10);

  // configured AI caller — Gemini when a key is set, Claude inside Claude.ai
  const callAI = useCallback((spec) => aiComplete(spec, settings), [settings]);

  /* ---------- toasts ---------- */
  const [toasts, setToasts] = useState([]);
  const dismissToast = useCallback((id) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const toast = useCallback((msg, opts = {}) => {
    const id = uid();
    setToasts((ts) => [...ts.slice(-2), { id, msg, undo: opts.undo }]);
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), opts.undo ? 5000 : 2400);
  }, []);

  /* ---------- load once ---------- */
  useEffect(() => {
    (async () => {
      const [s, p, legacyHistory, ui, cfg] = await Promise.all([
        loadKey("mizan:state"),
        loadKey("mizan:prices"),
        loadKey("mizan:history"),
        loadKey("mizan:ui"),
        loadKey("mizan:settings"),
      ]);
      // v1 kept net-worth history in its own key; migrate() folds it in
      setState(prune(migrate(s, { history: legacyHistory })));
      if (p && p.gold24) setPrices(p);
      if (ui && (ui.theme === "dark" || ui.theme === "light")) setTheme(ui.theme);
      if (cfg && typeof cfg === "object") {
        // the old default pinned "gemini-2.5-flash", which Google can retire;
        // "auto" resolves the current Flash at call time instead
        if (cfg.geminiModel === "gemini-2.5-flash") cfg.geminiModel = "auto";
        setSettings((d) => ({ ...d, ...cfg }));
      }
      setLoaded(true);
    })();
  }, []);

  /* ---------- persistence ----------
     Debounced: the document holds every account and transaction, and writing
     it synchronously on each edit janked the main thread once the ledger got
     long. storage.js flushes on pagehide, so nothing is lost on close. */
  useEffect(() => { if (loaded) saveKeyDebounced("mizan:state", state); }, [state, loaded]);
  useEffect(() => { if (loaded) saveKeyDebounced("mizan:prices", prices); }, [prices, loaded]);
  useEffect(() => { if (loaded) saveKey("mizan:ui", { theme }); }, [theme, loaded]);
  useEffect(() => { if (loaded) saveKey("mizan:settings", settings); }, [settings, loaded]);

  /* theme variables live on :root — keep the <html> attribute in sync so
     portaled modals (rendered into <body>) get the right palette */
  useEffect(() => { document.documentElement.setAttribute("data-theme", theme); }, [theme]);

  /* ---------- connectivity + service worker ---------- */
  useEffect(() => subscribeOnline(setOnline), []);
  useEffect(() => { initPWA({ onNeedRefresh: () => setUpdateReady(true) }); }, []);

  /* ---------- prices ---------- */
  const refreshPrices = useCallback(async () => {
    setFetching(true);
    const next = await fetchLivePrices(prices);
    if (next.source !== "blocked") setPrices(next);
    setFetching(false);
    return next;
  }, [prices]);

  const refreshWeb = useCallback(async () => {
    setWebBusy(true);
    setWebErr(null);
    try {
      const r = await fetchWebPrices(callAI);
      setPrices((p) => ({
        ...p,
        usdEgp: r.usdEgp,
        gold24: r.gold24,
        source: "web",
        sourceName: r.sourceName,
        priceDate: r.priceDate,
        updated: Date.now(),
      }));
      if (r.stale) {
        setWebErr("Pulled a price, but the freshest source found is dated " + r.priceDate + " — markets may have moved since. Refresh again or check the source.");
      }
    } catch {
      setWebErr("Couldn't read a clean price from the web. Try again, or set it by hand below.");
    }
    setWebBusy(false);
  }, [callAI]);

  /* one refresh attempt after load; the AI route is the fallback when the
     direct feeds and the proxy are both unavailable */
  useEffect(() => {
    if (!loaded || didInit.current) return;
    didInit.current = true;
    (async () => {
      const next = await fetchLivePrices(prices);
      if (next.source !== "blocked") setPrices(next);
      else refreshWeb();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  /* ---------- derived ---------- */
  const accounts = useMemo(() => live(state, "accounts"), [state]);
  const debts = useMemo(() => live(state, "debts"), [state]);

  const valued = useMemo(() => accounts.map((a) => ({ ...a, egp: egpValue(a, prices) })), [accounts, prices]);

  const totals = useMemo(() => {
    const acctAssets = valued.filter((a) => !a.isLiability).reduce((s, a) => s + a.egp, 0);
    const acctLiab = valued.filter((a) => a.isLiability).reduce((s, a) => s + Math.abs(a.egp), 0);
    const receivable = debts.filter((d) => d.dir === "owed").reduce((s, d) => s + (Number(d.amount) || 0), 0);
    const payable = debts.filter((d) => d.dir === "owe").reduce((s, d) => s + (Number(d.amount) || 0), 0);
    const byClass = {};
    CLASS_ORDER.forEach((c) => (byClass[c] = 0));
    valued.filter((a) => !a.isLiability).forEach((a) => (byClass[a.assetClass] = (byClass[a.assetClass] || 0) + a.egp));
    const liquidTotal = LIQUID_CLASSES.reduce((s, c) => s + (byClass[c] || 0), 0);
    const illiquidTotal = byClass[ILLIQUID_CLASS] || 0;
    const assets = acctAssets + receivable;
    const liabilities = acctLiab + payable;
    return { assets, liabilities, net: assets - liabilities, byClass, liquidTotal, illiquidTotal };
  }, [valued, debts]);

  const { assets, liabilities, net, byClass, liquidTotal, illiquidTotal } = totals;

  /* ---------- daily snapshots ----------
     One net-worth entry per day; same-day changes overwrite. */
  useEffect(() => {
    if (!loaded) return;
    const entry = {
      d: today,
      net: Math.round(net),
      liquid: Math.round(liquidTotal),
      illiquid: Math.round(illiquidTotal),
      updatedAt: Date.now(),
    };
    setState((s) => {
      const h = s.history || [];
      const last = h[h.length - 1];
      if (last && last.d === today) {
        if (last.net === entry.net && last.liquid === entry.liquid && last.illiquid === entry.illiquid) return s;
        return { ...s, history: [...h.slice(0, -1), entry] };
      }
      return { ...s, history: [...h, entry].slice(-HISTORY_LIMIT) };
    });
  }, [loaded, net, liquidTotal, illiquidTotal, today]);

  /* one gold/FX close per day, so the Prices tab can chart the market */
  useEffect(() => {
    if (!loaded || !prices.gold24) return;
    setState((s) => {
      const next = recordPriceDay(s.priceHistory, prices);
      const cur = s.priceHistory || [];
      const same = cur.length === next.length && cur.length && cur[cur.length - 1].gold24 === next[next.length - 1].gold24;
      return same ? s : { ...s, priceHistory: next };
    });
  }, [loaded, prices]);

  /* ---------- zakat hawl clock ----------
     Crossing nisab starts the lunar year; dropping below resets it. Kept here
     rather than in the card so the clock keeps running whether or not the
     Overview tab is on screen. */
  useEffect(() => {
    if (!loaded || !liquidTotal) return;
    const st = zakatStatus({ zakat: state.zakat, liquidTotal, illiquidTotal, liabilities, prices, today });
    const next = nextHawlStart(st, today);
    if (next === undefined) return;
    setState((s) => touchScalar(s, "zakat", { ...(s.zakat || {}), hawlStart: next }));
  }, [loaded, liquidTotal, illiquidTotal, liabilities, prices, state.zakat, today]);

  const setZakat = useCallback((z) => setState((s) => touchScalar(s, "zakat", z)), []);

  /* ---------- sync ---------- */
  const adopt = useCallback((doc) => setState(prune(migrate(doc))), []);
  const sync = useSync({ state, adopt, loaded });

  if (!loaded) {
    return (
      <div className="min-h-screen mz-root" data-theme={theme} style={{ fontFamily: BODY_FONT }}>
        <FontLoader />
        <div className="max-w-3xl mx-auto px-4 pt-6 space-y-3">
          <div className="flex items-center justify-between mb-1">
            <div className="mz-skel h-7 w-24" />
            <div className="mz-skel h-4 w-36" />
          </div>
          <div className="mz-skel w-full" style={{ height: "15rem" }} />
          <div className="mz-skel w-full" style={{ height: "11rem" }} />
          <div className="mz-skel w-full" style={{ height: "7rem" }} />
        </div>
      </div>
    );
  }

  return (
    <ToastCtx.Provider value={toast}>
      <AICtx.Provider value={callAI}>
        <div className="min-h-screen mz-root" data-theme={theme} style={{ fontFamily: BODY_FONT, colorScheme: theme }}>
          <FontLoader />

          {settingsOpen ? (
            <Suspense fallback={<div className="max-w-3xl mx-auto px-4 pt-6"><TabFallback /></div>}>
              <SettingsPage
                settings={settings} setSettings={setSettings}
                state={state} setState={setState}
                prices={prices} setPrices={setPrices}
                theme={theme} setTheme={setTheme}
                sync={sync}
                onBack={() => setSettingsOpen(false)}
              />
            </Suspense>
          ) : (
            <>
              <div className="max-w-3xl mx-auto px-4 pb-16 pt-6">
                <Header
                  theme={theme}
                  onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
                  onOpenSettings={() => setSettingsOpen(true)}
                  sync={sync}
                  online={online}
                />

                <NetWorthBlock
                  net={net}
                  liabilities={liabilities}
                  byClass={byClass}
                  targets={state.targets}
                  prices={prices}
                  liquidTotal={liquidTotal}
                  illiquidTotal={illiquidTotal}
                  history={state.history}
                />

                <div key={tab} className="mz-tabview space-y-3">
                  {tab === "overview" && (
                    <Overview
                      byClass={byClass} liquidTotal={liquidTotal} illiquidTotal={illiquidTotal}
                      liabilities={liabilities} targets={state.targets} prices={prices}
                      fetching={fetching} onRefresh={refreshPrices} onRefreshWeb={refreshWeb}
                      webBusy={webBusy} webErr={webErr}
                      hasAccounts={accounts.length > 0} onNavigate={setTab}
                      zakat={state.zakat} onZakatChange={setZakat} today={today}
                    />
                  )}
                  {tab === "accounts" && <Accounts valued={valued} state={state} setState={setState} />}
                  {tab === "activity" && (
                    <Activity state={state} setState={setState} prices={prices} focusSignal={qaFocus} onNavigate={setTab} />
                  )}
                  {tab === "spending" && (
                    <Suspense fallback={<TabFallback />}>
                      <Spending state={state} setState={setState} prices={prices} />
                    </Suspense>
                  )}
                  {tab === "prices" && (
                    <Suspense fallback={<TabFallback />}>
                      <PricesTab
                        prices={prices} setPrices={setPrices}
                        fetching={fetching} onRefresh={refreshPrices} onRefreshWeb={refreshWeb}
                        webBusy={webBusy} webErr={webErr}
                        state={state} setState={setState}
                      />
                    </Suspense>
                  )}
                </div>
              </div>

              {/* floating quick-add: one tap from anywhere to start logging */}
              <button
                onClick={() => { setTab("activity"); setQaFocus((k) => k + 1); }}
                aria-label="Log a transaction"
                className="mz-fab fixed z-40"
                style={{ right: "1rem", bottom: "calc(64px + env(safe-area-inset-bottom))" }}
              >
                <Plus size={24} strokeWidth={2.4} />
              </button>

              <TabBar tab={tab} setTab={setTab} />
            </>
          )}

          {/* a new build is ready — announced, not forced, so a reload never
              lands mid-edit */}
          {updateReady && (
            <div className="fixed inset-x-0 z-50 flex justify-center px-4" style={{ bottom: "calc(112px + env(safe-area-inset-bottom))" }}>
              <div className="mz-toast flex items-center gap-3 px-4 py-2.5 rounded-full"
                   style={{ background: INK, color: "#EAF1FF", border: `1px solid ${HAIRLINE}`, boxShadow: "0 8px 24px rgba(12,23,48,0.35)" }}>
                <span className="text-[12px]" style={{ fontFamily: MONO_FONT }}>New version ready</span>
                <button onClick={reloadWithUpdate} className="text-[12px] font-semibold inline-flex items-center gap-1" style={{ color: ACCENT, fontFamily: MONO_FONT }}>
                  <RefreshCw size={12} strokeWidth={2.4} /> Reload
                </button>
                <button onClick={() => setUpdateReady(false)} aria-label="Dismiss" className="text-[12px]" style={{ color: "#8FA0BF", fontFamily: MONO_FONT }}>later</button>
              </div>
            </div>
          )}

          {/* toasts (both views) */}
          <div className="fixed inset-x-0 z-40 flex flex-col items-center gap-2 px-4 pointer-events-none" style={{ bottom: "calc(64px + env(safe-area-inset-bottom))" }}>
            {toasts.map((t) => (
              <div key={t.id} className="mz-toast pointer-events-auto flex items-center gap-3 px-4 py-2.5 rounded-full"
                   style={{ background: INK, color: "#EAF1FF", border: `1px solid ${HAIRLINE}`, boxShadow: "0 8px 24px rgba(12,23,48,0.35)" }}>
                <span className="text-[12px]" style={{ fontFamily: MONO_FONT }}>{t.msg}</span>
                {t.undo && (
                  <button onClick={() => { t.undo(); dismissToast(t.id); }} className="text-[12px] font-semibold" style={{ color: ACCENT, fontFamily: MONO_FONT }}>
                    Undo
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </AICtx.Provider>
    </ToastCtx.Provider>
  );
}
