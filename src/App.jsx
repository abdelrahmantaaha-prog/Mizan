import React, { useState, useEffect, useMemo, useRef, useCallback, createContext, useContext } from "react";
import {
  PieChart, Wallet, ArrowRightLeft, BarChart3, Coins,
  Landmark, TrendingUp, Banknote, Building2,
  UtensilsCrossed, Car, Home, Users, HeartPulse, ShoppingBag,
  ReceiptText, HandHeart, Sparkles, ArrowDownToLine, Tag,
  Plus, Pencil, Trash2, Check, Moon, Sun, X,
  Settings as SettingsIcon, ArrowLeft, KeyRound,
} from "lucide-react";
import { loadKey, saveKey } from "./lib/storage.js";
import { aiComplete, aiProviderName, testGeminiKey, DEFAULT_GEMINI_MODEL, GEMINI_MODELS } from "./lib/ai.js";

/* ============================================================
   MIZAN — ميزان
   A net-worth + activity tracker built for Egyptian holdings:
   native gold-by-karat accounts valued at live EGP spot, plus
   multi-currency cash and a liquid-only allocation ribbon.
   ============================================================ */

// theme: "Deep water." Midnight-navy ink, electric blue accent.
// Light/dark theme colors live in CSS variables (see FontLoader): --bg, --card,
// --line, --ink, --muted, --faint, --sub, --sub2. The constants below are the
// theme-independent anchors: the hero card is always dark navy.
const INK = "#0C1730";       // midnight navy (hero card bg, toasts)
const INK_2 = "#152341";     // panel navy, one step lighter
const HAIRLINE = "#233458";  // border on dark panels
const ACCENT = "#3B7DFF";    // electric blue accent
const ACCENT_DIM = "#2563EB";
const MUTED_ON_DARK = "#8FA0BF";

// Every asset class the app knows. Illiquid is tracked and counts toward net
// worth, but it is deliberately excluded from the liquid allocation ribbon.
const CLASS_ORDER = ["Money market", "Gold", "Equity", "Cash", "Illiquid"];
// Only these four are rebalanced against targets.
const LIQUID_CLASSES = ["Money market", "Gold", "Equity", "Cash"];
const ILLIQUID_CLASS = "Illiquid";
const CLASS_COLOR = {
  "Money market": "#22B8CF", // cyan
  Gold: "#F2A93B",           // amber — gold stays gold
  Equity: "#6366F1",         // indigo
  Cash: "#5B7CC4",           // steel blue
  Illiquid: "#8B5CF6",       // violet (sits outside the ribbon)
};
const LIABILITY_COLOR = "#F4506B"; // coral-red
const OZ_TO_GRAM = 31.1034768;

const DISPLAY_FONT = "'Space Grotesk', ui-sans-serif, system-ui, sans-serif";
const MONO_FONT = "'JetBrains Mono', ui-monospace, 'SF Mono', monospace";

// icons ---------------------------------------------------------------
const CLASS_ICON = {
  "Money market": Landmark,
  Gold: Coins,
  Equity: TrendingUp,
  Cash: Banknote,
  Illiquid: Building2,
};
const CAT_ICON = {
  Food: UtensilsCrossed,
  Transport: Car,
  Housing: Home,
  Family: Users,
  Health: HeartPulse,
  Shopping: ShoppingBag,
  Bills: ReceiptText,
  Investment: TrendingUp,
  Giving: HandHeart,
  Personal: Sparkles,
  Income: ArrowDownToLine,
  Other: Tag,
};
const catIcon = (name) => CAT_ICON[name] || Tag;

function FontLoader() {
  useEffect(() => {
    if (document.getElementById("mizan-fonts")) return;
    const link = document.createElement("link");
    link.id = "mizan-fonts";
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap";
    document.head.appendChild(link);
  }, []);
  return (
    <style>{`
      /* ---- theme tokens ---- */
      .mz-root {
        --bg: #EEF3FB; --card: #FFFFFF; --line: #DCE4F1;
        --ink: #1B2740; --muted: #6B7A93; --faint: #A6B3C9;
        --sub: #F1F5FA; --sub2: #E3EAF4;
        background: var(--bg); color: var(--ink);
      }
      .mz-root[data-theme="dark"] {
        --bg: #0B1424; --card: #121F38; --line: #243756;
        --ink: #E7EEFB; --muted: #93A3C2; --faint: #5E6F8F;
        --sub: #1A2A4A; --sub2: #24365E;
      }

      /* ---- var-driven utilities (theme both ways) ---- */
      .mz-tx1 { color: var(--ink); } .mz-tx2 { color: var(--muted); } .mz-tx3 { color: var(--faint); }
      .mz-sub { background: var(--sub); } .mz-sub2 { background: var(--sub2); }
      .mz-bd { border-color: var(--line); }
      .mz-dv > * + * { border-color: var(--line); }
      .mz-segon { background: var(--card); color: var(--ink); }
      .mz-hovi:hover { color: var(--ink); } .mz-hovm:hover { color: var(--muted); }
      .mz-hovbd:hover { border-color: var(--muted); }
      .mz-input { background: var(--card); border: 1px solid var(--line); color: var(--ink); }
      .mz-input::placeholder { color: var(--faint); }
      .mz-note-rose  { background: rgba(225,29,72,0.08);  border-color: rgba(225,29,72,0.28); }
      .mz-note-amber { background: rgba(217,119,6,0.10);  border-color: rgba(217,119,6,0.30); }
      .mz-note-teal  { background: rgba(13,148,136,0.10); border-color: rgba(13,148,136,0.30); }
      .mz-note-blue  { background: rgba(59,125,255,0.10); border-color: rgba(59,125,255,0.30); }
      .mz-note-mut   { background: var(--sub); border-color: var(--line); }
      .mz-txblue { color: #2563EB; } .mz-root[data-theme="dark"] .mz-txblue { color: #7EA6FF; }
      .mz-txteal { color: #0F766E; } .mz-root[data-theme="dark"] .mz-txteal { color: #2DD4BF; }
      .mz-txamber { color: #B45309; } .mz-root[data-theme="dark"] .mz-txamber { color: #FBBF24; }
      .mz-txamber2 { color: #78350F; } .mz-root[data-theme="dark"] .mz-txamber2 { color: #FDE68A; }

      .mz-btn-primary { background: ${ACCENT}; color: #FFFFFF; transition: background 0.15s ease, transform 0.12s ease, box-shadow 0.15s ease; box-shadow: 0 1px 2px rgba(12,23,48,0.10); }
      .mz-btn-primary:hover:not(:disabled) { background: ${ACCENT_DIM}; box-shadow: 0 4px 14px rgba(59,125,255,0.28); }
      .mz-btn-primary:active:not(:disabled) { transform: translateY(1px); }
      .mz-btn-primary:disabled { opacity: 0.5; }

      /* padded icon buttons: ≥40px hit area */
      .mz-iconbtn { padding: 0.55rem; border-radius: 0.6rem; line-height: 0; transition: background 0.15s ease, color 0.15s ease, transform 0.1s ease; }
      .mz-iconbtn:hover { background: var(--sub); }
      .mz-iconbtn:active { transform: scale(0.9); }
      .mz-hovrose:hover { color: #E11D48; }
      .mz-hovblue:hover { color: ${ACCENT}; }

      @keyframes mzRise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
      @keyframes mzFade { from { opacity: 0; } to { opacity: 1; } }
      @keyframes mzShimmer { from { background-position: -200% 0; } to { background-position: 200% 0; } }

      .mz-skel { border-radius: 1rem; background: linear-gradient(90deg, var(--sub) 25%, var(--sub2) 50%, var(--sub) 75%); background-size: 200% 100%; animation: mzShimmer 1.3s linear infinite; }

      /* content of the active tab rises in, with a gentle stagger between cards */
      .mz-tabview > * { animation: mzRise 0.44s cubic-bezier(.22,1,.36,1) both; }
      .mz-tabview > *:nth-child(1){ animation-delay: .00s; }
      .mz-tabview > *:nth-child(2){ animation-delay: .05s; }
      .mz-tabview > *:nth-child(3){ animation-delay: .10s; }
      .mz-tabview > *:nth-child(4){ animation-delay: .15s; }
      .mz-tabview > *:nth-child(5){ animation-delay: .20s; }
      .mz-tabview > *:nth-child(n+6){ animation-delay: .24s; }

      .mz-card { background: var(--card); border: 1px solid var(--line); transition: box-shadow 0.2s ease, transform 0.2s ease, border-color 0.2s ease; }
      .mz-card:hover { box-shadow: 0 10px 30px rgba(20,35,72,0.10); transform: translateY(-1px); border-color: ${ACCENT}33; }

      .mz-bar { transition: width 0.6s cubic-bezier(.22,1,.36,1); }

      /* bottom tab bar */
      .mz-bottombar { background: color-mix(in srgb, var(--card) 84%, transparent); border-top: 1px solid var(--line); }
      .mz-tabbtn { transition: color 0.2s ease, background 0.2s ease, transform 0.15s ease; }
      .mz-tabbtn:active { transform: scale(0.92); }
      .mz-tabicon { transition: transform 0.25s cubic-bezier(.34,1.56,.64,1); }
      .mz-tabbtn[data-active="true"] .mz-tabicon { transform: scale(1.05); }
      .mz-tablabel { animation: mzFade 0.25s ease both; }

      /* floating quick-add */
      .mz-fab { width: 52px; height: 52px; border-radius: 9999px; background: ${ACCENT}; color: #fff; display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 24px rgba(59,125,255,0.42); transition: transform 0.15s ease, box-shadow 0.2s ease; }
      .mz-fab:hover { box-shadow: 0 10px 30px rgba(59,125,255,0.55); }
      .mz-fab:active { transform: scale(0.9); }

      /* toasts */
      .mz-toast { animation: mzRise 0.28s cubic-bezier(.22,1,.36,1) both; }

      /* modal overlay */
      .mz-backdrop { background: rgba(8,14,28,0.55); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); animation: mzFade 0.2s ease both; }
      .mz-modal { animation: mzSheet 0.32s cubic-bezier(.22,1,.36,1) both; }
      @keyframes mzSheet { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: none; } }

      @media (prefers-reduced-motion: reduce) {
        .mz-tabview > *, .mz-tablabel, .mz-tabicon, .mz-bar, .mz-card, .mz-toast, .mz-skel, .mz-fab, .mz-iconbtn, .mz-modal, .mz-backdrop { animation: none !important; transition: none !important; }
      }
    `}</style>
  );
}

// main category -> subcategories (editable defaults; custom values always allowed)
const TAXONOMY = {
  Food: ["Groceries", "Restaurants", "Coffee", "Delivery"],
  Transport: ["Fuel", "Taxi/Uber", "Public transport", "Car/Maintenance", "Parking"],
  Housing: ["Rent", "Utilities", "Internet/Phone", "Maintenance", "Furniture"],
  Family: ["Childcare", "Education", "Kids/Clothing", "Activities"],
  Health: ["Doctor", "Pharmacy", "Insurance", "Fitness"],
  Shopping: ["Electronics", "Clothing", "Household", "Gifts"],
  Bills: ["Subscriptions", "Phone", "Internet", "Insurance"],
  Investment: ["Gold", "Equity", "Savings", "Real estate"],
  Giving: ["Zakat", "Sadaqah", "Gifts"],
  Personal: ["Entertainment", "Travel", "Self-care", "Misc"],
  Income: ["Salary", "Freelance", "Dividends", "Other"],
  Other: [],
};
const MAIN_CATS = Object.keys(TAXONOMY);

const SEED_STATE = {
  accounts: [
    { id: "a1", name: "Thndr — Clouds (Instant)", assetClass: "Money market", unit: "EGP", balance: 338564.38, broker: "Thndr" },
    { id: "a2", name: "Thndr — Wallet", assetClass: "Cash", unit: "EGP", balance: 48520, broker: "Thndr" },
    { id: "a3", name: "Azimut Gold (AZG)", assetClass: "Gold", unit: "EGP", balance: 45725.2, broker: "Thndr" },
    { id: "a4", name: "Beltone fund (BWA)", assetClass: "Equity", unit: "EGP", balance: 9762.29, broker: "Thndr" },
    { id: "a5", name: "Al Fanar (FNAR)", assetClass: "Equity", unit: "EGP", balance: 58.35, broker: "Thndr" },
    { id: "a6", name: "CIB — debit", assetClass: "Cash", unit: "EGP", balance: 86768 },
    { id: "a7", name: "Cash (EGP)", assetClass: "Cash", unit: "EGP", balance: 80000 },
    { id: "a8", name: "CIB — card (installments)", assetClass: "Cash", unit: "EGP", balance: -50105, isLiability: true },
    { id: "a9", name: "Physical gold — 24K", assetClass: "Gold", unit: "GOLD", karat: 24, balance: 5 },
    { id: "a10", name: "Physical gold — 21K", assetClass: "Gold", unit: "GOLD", karat: 21, balance: 4 },
    { id: "a11", name: "Physical gold — 18K", assetClass: "Gold", unit: "GOLD", karat: 18, balance: 16.63 },
    { id: "a12", name: "ADIB ($)", assetClass: "Cash", unit: "USD", balance: 10 },
    { id: "a13", name: "Cash ($)", assetClass: "Cash", unit: "USD", balance: 250 },
  ],
  transactions: [],
  targets: { "Money market": 40, Gold: 25, Equity: 27, Cash: 8 },
  budgets: {},
  debts: [],
};

const SEED_PRICES = { usdEgp: 49.9, gold24: 6500, source: "seed", sourceName: "fallback baseline", priceDate: "2026-06-26", updated: Date.now() };

/* Storage lives in ./lib/storage.js (artifact store → localStorage → memory).
   AI calls live in ./lib/ai.js (Gemini with your key, or Claude inside Claude.ai).
   Components reach the configured AI through this context: */
const AICtx = createContext(async () => { throw new Error("ai-unavailable"); });

/* ---------- valuation ---------- */
function karatPrice(prices, karat) {
  return prices.gold24 * (karat / 24);
}
function egpValue(acc, prices) {
  if (acc.unit === "USD") return acc.balance * prices.usdEgp;
  if (acc.unit === "GOLD") return acc.balance * karatPrice(prices, acc.karat || 24);
  return acc.balance;
}
function unitLabel(acc) {
  if (!acc) return "";
  if (acc.unit === "USD") return "$";
  if (acc.unit === "GOLD") return "g";
  return "EGP";
}

/* ---------- formatting ---------- */
const fmtEGP = (n) =>
  (n < 0 ? "−" : "") + "EGP " + Math.round(Math.abs(n)).toLocaleString("en-US");
// compact form for tight layouts (hero stat columns): 3,412,000 → "EGP 3.41M"
const fmtEGPShort = (n) => {
  const a = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (a >= 1e6) return sign + "EGP " + (a / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.?0+$/, "") + "M";
  return sign + "EGP " + Math.round(a).toLocaleString("en-US");
};
const fmtNum = (n, d = 2) =>
  Number(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: d });
const fmtPct = (n) => (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(1) + "%";
const timeAgo = (ts) => {
  if (!ts) return "never";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
};

/* ---------- live price fetch (best-effort) ---------- */
async function fetchLivePrices(prev) {
  let usdEgp = prev.usdEgp;
  let gotFx = false,
    gotGold = false;
  let spotUsd = null;
  try {
    const fx = await fetch("https://open.er-api.com/v6/latest/USD");
    const j = await fx.json();
    if (j && j.rates && j.rates.EGP) {
      usdEgp = j.rates.EGP;
      gotFx = true;
    }
  } catch {}
  try {
    const g = await fetch("https://api.gold-api.com/price/XAU");
    const j = await g.json();
    if (j && j.price) {
      spotUsd = j.price;
      gotGold = true;
    }
  } catch {}
  let gold24 = prev.gold24;
  if (gotGold && usdEgp) gold24 = (spotUsd / OZ_TO_GRAM) * usdEgp;
  const ok = gotFx && gotGold;
  return {
    usdEgp,
    gold24,
    source: ok ? "live" : gotFx || gotGold ? "partial" : "blocked",
    sourceName: ok ? "spot XAU × USD/EGP" : prev.sourceName,
    priceDate: ok ? new Date().toISOString().slice(0, 10) : prev.priceDate,
    updated: Date.now(),
  };
}

/* ---------- web price fetch via AI + search grounding ---------- */
async function fetchWebPrices(ai) {
  const today = new Date().toISOString().slice(0, 10);
  const prompt =
    `Today's date is ${today}. You MUST use your web/search tool to look up the most recent Egyptian gold price ` +
    `and USD/EGP rate — do not answer from memory. Search Arabic sources like "سعر جرام الذهب عيار 24 مصر اليوم". ` +
    "Find a source whose price is dated today or as recent as possible, and read the date it was published. " +
    "Then reply with ONLY a JSON object, no prose, no markdown fences. Exact shape: " +
    '{"gold24_egp_per_gram": <number>, "usd_egp": <number>, "as_of_date": "YYYY-MM-DD", "source": "<short site name>"}. ' +
    "gold24_egp_per_gram = price of one gram of 24-karat gold in the Egyptian local market (الصاغة), in EGP. " +
    "usd_egp = Egyptian pounds per one US dollar. as_of_date = the date the price you are reporting was published by that source.";
  const text = await ai({ prompt, search: true });
  const match = text.replace(/```json/g, "").replace(/```/g, "").match(/\{[\s\S]*\}/);
  if (!match) throw new Error("no-json");
  const parsed = JSON.parse(match[0]);
  const gold24 = Number(parsed.gold24_egp_per_gram);
  const usdEgp = Number(parsed.usd_egp);
  if (!(gold24 > 2000 && gold24 < 20000)) throw new Error("gold-range");
  if (!(usdEgp > 20 && usdEgp < 150)) throw new Error("fx-range");
  const priceDate = /^\d{4}-\d{2}-\d{2}$/.test(parsed.as_of_date || "") ? parsed.as_of_date : today;
  const stale = (Date.now() - new Date(priceDate).getTime()) / 86400000 > 2;
  return {
    gold24,
    usdEgp,
    priceDate,
    sourceName: (parsed.source || "web search").toString().slice(0, 40),
    stale,
  };
}

const uid = () => Math.random().toString(36).slice(2, 9);

/* ---------- toast context: components call toast(msg, {undo}) ---------- */
const ToastCtx = createContext(() => {});

/* ---------- modal overlay: bottom sheet on phones, centered dialog on wider screens ---------- */
function Modal({ title, onClose, children }) {
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // lock page scroll behind the sheet
    return () => { window.removeEventListener("keydown", h); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 mz-backdrop" onClick={onClose} />
      <div className="mz-modal relative w-full sm:max-w-md max-h-[88vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-4"
           style={{ background: "var(--card)", border: "1px solid var(--line)", boxShadow: "0 -12px 40px rgba(8,14,28,0.30)" }}>
        <div className="flex items-center justify-between mb-3">
          <CardTitle>{title}</CardTitle>
          <button onClick={onClose} aria-label="Close" className="mz-iconbtn mz-tx3 -mr-2"><X size={16} strokeWidth={2} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ---------- count-up: eases a number toward its new value ---------- */
function useCountUp(value, dur = 600) {
  const [disp, setDisp] = useState(value);
  const prev = useRef(value);
  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const from = prev.current, to = value;
    prev.current = value;
    if (reduce || from === to || typeof requestAnimationFrame === "undefined") { setDisp(value); return; }
    let raf;
    const t0 = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      setDisp(from + (to - from) * e);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, dur]);
  return disp;
}

/* ============================================================ */
export default function Mizan() {
  const [loaded, setLoaded] = useState(false);
  const [state, setState] = useState(SEED_STATE);
  const [prices, setPrices] = useState(SEED_PRICES);
  const [history, setHistory] = useState([]); // daily net-worth snapshots
  const [theme, setTheme] = useState("light");
  const [settings, setSettings] = useState({ geminiKey: "", geminiModel: DEFAULT_GEMINI_MODEL });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tab, setTab] = useState("overview");
  const [fetching, setFetching] = useState(false);
  const [webBusy, setWebBusy] = useState(false);
  const [webErr, setWebErr] = useState(null);
  const [qaFocus, setQaFocus] = useState(0); // FAB → focus the quick-add box
  const didInit = useRef(false);

  // configured AI caller — Gemini when a key is set, Claude inside Claude.ai
  const callAI = useCallback((spec) => aiComplete(spec, settings), [settings]);

  // toasts
  const [toasts, setToasts] = useState([]);
  const dismissToast = useCallback((id) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const toast = useCallback((msg, opts = {}) => {
    const id = uid();
    setToasts((ts) => [...ts.slice(-2), { id, msg, undo: opts.undo }]);
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), opts.undo ? 5000 : 2400);
  }, []);

  // load once
  useEffect(() => {
    (async () => {
      const s = await loadKey("mizan:state");
      const p = await loadKey("mizan:prices");
      const h = await loadKey("mizan:history");
      const ui = await loadKey("mizan:ui");
      const cfg = await loadKey("mizan:settings");
      if (s) setState(s);
      if (p) setPrices(p);
      if (Array.isArray(h)) setHistory(h);
      if (ui && (ui.theme === "dark" || ui.theme === "light")) setTheme(ui.theme);
      if (cfg && typeof cfg === "object") setSettings((d) => ({ ...d, ...cfg }));
      setLoaded(true);
    })();
  }, []);
  useEffect(() => {
    if (loaded) saveKey("mizan:ui", { theme });
  }, [theme, loaded]);
  useEffect(() => {
    if (loaded) saveKey("mizan:settings", settings);
  }, [settings, loaded]);

  // persist
  useEffect(() => {
    if (loaded) saveKey("mizan:state", state);
  }, [state, loaded]);
  useEffect(() => {
    if (loaded) saveKey("mizan:prices", prices);
  }, [prices, loaded]);

  // attempt one refresh after load: cheap direct feed first, web fallback if blocked
  useEffect(() => {
    if (loaded && !didInit.current) {
      didInit.current = true;
      (async () => {
        const next = await fetchLivePrices(prices);
        if (next.source !== "blocked") setPrices(next);
        else refreshWeb();
      })();
    }
    // eslint-disable-next-line
  }, [loaded]);

  async function refreshPrices() {
    setFetching(true);
    const next = await fetchLivePrices(prices);
    setPrices(next);
    setFetching(false);
  }

  async function refreshWeb() {
    setWebBusy(true);
    setWebErr(null);
    try {
      const r = await fetchWebPrices(callAI);
      setPrices({ usdEgp: r.usdEgp, gold24: r.gold24, source: "web", sourceName: r.sourceName, priceDate: r.priceDate, updated: Date.now() });
      if (r.stale) setWebErr("Pulled a price, but the freshest source found is dated " + r.priceDate + " — markets may have moved since. Refresh again or check the source.");
    } catch (e) {
      setWebErr("Couldn't read a clean price from the web. Try again, or set it by hand below.");
    }
    setWebBusy(false);
  }

  /* derived */
  const valued = useMemo(
    () => state.accounts.map((a) => ({ ...a, egp: egpValue(a, prices) })),
    [state.accounts, prices]
  );
  const acctAssets = valued.filter((a) => !a.isLiability).reduce((s, a) => s + a.egp, 0);
  const acctLiab = valued.filter((a) => a.isLiability).reduce((s, a) => s + Math.abs(a.egp), 0);
  const debts = state.debts || [];
  const receivable = debts.filter((d) => d.dir === "owed").reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const payable = debts.filter((d) => d.dir === "owe").reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const assets = acctAssets + receivable;
  const liabilities = acctLiab + payable;
  const net = assets - liabilities;
  const byClass = useMemo(() => {
    const m = {};
    CLASS_ORDER.forEach((c) => (m[c] = 0));
    valued.filter((a) => !a.isLiability).forEach((a) => (m[a.assetClass] = (m[a.assetClass] || 0) + a.egp));
    return m;
  }, [valued]);
  const liquidTotal = LIQUID_CLASSES.reduce((s, c) => s + (byClass[c] || 0), 0);
  const illiquidTotal = byClass[ILLIQUID_CLASS] || 0;

  // daily net-worth snapshot: one entry per day, same-day changes overwrite, capped at a year
  useEffect(() => {
    if (!loaded) return;
    const d = new Date().toISOString().slice(0, 10);
    const entry = { d, net: Math.round(net), liquid: Math.round(liquidTotal), illiquid: Math.round(illiquidTotal) };
    setHistory((h) => {
      const last = h[h.length - 1];
      if (last && last.d === d) {
        if (last.net === entry.net && last.liquid === entry.liquid) return h;
        return [...h.slice(0, -1), entry];
      }
      return [...h, entry].slice(-365);
    });
  }, [loaded, net, liquidTotal, illiquidTotal]);
  useEffect(() => {
    if (loaded) saveKey("mizan:history", history);
  }, [history, loaded]);

  if (!loaded)
    return (
      <div className="min-h-screen mz-root" data-theme={theme} style={{ fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif" }}>
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

  return (
    <ToastCtx.Provider value={toast}>
    <AICtx.Provider value={callAI}>
      <div className="min-h-screen mz-root" data-theme={theme} style={{ fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif", colorScheme: theme }}>
        <FontLoader />
        {settingsOpen ? (
          <SettingsPage
            settings={settings} setSettings={setSettings}
            state={state} setState={setState}
            prices={prices} setPrices={setPrices}
            history={history} setHistory={setHistory}
            theme={theme} setTheme={setTheme}
            onBack={() => setSettingsOpen(false)}
          />
        ) : (
        <>
        <div className="max-w-3xl mx-auto px-4 pb-16 pt-6">
          <Header theme={theme} onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))} onOpenSettings={() => setSettingsOpen(true)} />
          <NetWorthBlock net={net} assets={assets} liabilities={liabilities} byClass={byClass} targets={state.targets} prices={prices} liquidTotal={liquidTotal} illiquidTotal={illiquidTotal} history={history} />

          <div key={tab} className="mz-tabview space-y-3">
            {tab === "overview" && (
              <Overview byClass={byClass} liquidTotal={liquidTotal} illiquidTotal={illiquidTotal} liabilities={liabilities} targets={state.targets} prices={prices} fetching={fetching} onRefresh={refreshPrices} onRefreshWeb={refreshWeb} webBusy={webBusy} webErr={webErr} />
            )}
            {tab === "accounts" && (
              <Accounts valued={valued} setState={setState} prices={prices} state={state} />
            )}
            {tab === "activity" && (
              <Activity state={state} setState={setState} prices={prices} focusSignal={qaFocus} />
            )}
            {tab === "spending" && (
              <Spending state={state} setState={setState} prices={prices} />
            )}
            {tab === "prices" && (
              <PricesTab prices={prices} setPrices={setPrices} fetching={fetching} onRefresh={refreshPrices} onRefreshWeb={refreshWeb} webBusy={webBusy} webErr={webErr} state={state} setState={setState} />
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

/* ---------- header ---------- */
function Header({ theme, onToggleTheme, onOpenSettings }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-baseline gap-3">
        <h1 className="text-2xl tracking-tight mz-tx1" style={{ fontFamily: DISPLAY_FONT, fontWeight: 700 }}>Mizan</h1>
        <span className="text-lg" style={{ fontFamily: "'Space Grotesk', serif", color: ACCENT }}>ميزان</span>
      </div>
      <div className="flex items-center gap-0.5">
        <span className="text-[11px] uppercase tracking-widest mz-tx2" style={{ fontFamily: MONO_FONT }}>net worth · live gold</span>
        <button onClick={onToggleTheme} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} className="mz-iconbtn mz-tx2">
          {theme === "dark" ? <Sun size={16} strokeWidth={2} /> : <Moon size={16} strokeWidth={2} />}
        </button>
        <button onClick={onOpenSettings} aria-label="Settings" className="mz-iconbtn mz-tx2 -mr-2">
          <SettingsIcon size={16} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

/* small dark-card stat — compact figures so three columns never clip */
function HeroStat({ label, value, exact, color }) {
  return (
    <div className="min-w-0" title={exact || undefined}>
      <div className="text-[10px] uppercase tracking-widest" style={{ fontFamily: MONO_FONT, color: MUTED_ON_DARK }}>{label}</div>
      <div className="tabular-nums text-sm mt-0.5 truncate" style={{ fontFamily: MONO_FONT, color: color || "#EAF1FF" }}>{value}</div>
    </div>
  );
}

/* ---------- net worth hero: denomination toggle, history sparkline, liquid ribbon ---------- */
function SparkLine({ history }) {
  const data = history.slice(-90);
  if (data.length < 2) return null;
  const nets = data.map((x) => x.net);
  const min = Math.min(...nets), max = Math.max(...nets);
  const span = max - min || 1;
  const W = 600, H = 36;
  const xy = (v, i) => [((i / (nets.length - 1)) * W), (H - 3 - ((v - min) / span) * (H - 8))];
  const pts = nets.map((v, i) => xy(v, i).map((n) => n.toFixed(1)).join(",")).join(" ");
  const [lx, ly] = xy(nets[nets.length - 1], nets.length - 1);
  const first = nets[0], last = nets[nets.length - 1];
  const chg = first ? ((last - first) / Math.abs(first)) * 100 : 0;
  const up = chg >= 0;
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-widest" style={{ fontFamily: MONO_FONT, color: MUTED_ON_DARK }}>History</span>
        <span className="text-[10px] tabular-nums" style={{ fontFamily: MONO_FONT, color: up ? CLASS_COLOR["Money market"] : LIABILITY_COLOR }}>
          {fmtPct(chg)} since {data[0].d}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-9" role="img" aria-label="Net worth history">
        <polyline points={pts} fill="none" stroke={ACCENT} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={lx} cy={ly} r="3" fill={ACCENT} />
      </svg>
    </div>
  );
}

function NetWorthBlock({ net, assets, liabilities, byClass, targets, prices, liquidTotal, illiquidTotal, history }) {
  const [denom, setDenom] = useState("EGP"); // EGP -> USD -> GOLD -> EGP
  const usdEgp = prices.usdEgp || 1;
  const gold24 = prices.gold24 || 1;
  const base = liquidTotal || 1; // ribbon + targets are computed over LIQUID only
  const hasIlliquid = illiquidTotal > 0;

  const cycle = () => setDenom((d) => (d === "EGP" ? "USD" : d === "USD" ? "GOLD" : "EGP"));
  const animNet = useCountUp(net); // main figure eases toward new values
  const main =
    denom === "USD" ? "$" + Math.round(animNet / usdEgp).toLocaleString("en-US")
    : denom === "GOLD" ? fmtNum(animNet / gold24, 0) + " g"
    : fmtEGP(animNet);
  const sub =
    denom === "USD" ? fmtEGP(net) + " @ " + fmtNum(usdEgp, 2)
    : denom === "GOLD" ? fmtEGP(net) + " · 24K @ " + fmtNum(gold24, 0) + "/g"
    : "≈ $" + Math.round(net / usdEgp).toLocaleString("en-US") + " · ≈ " + fmtNum(net / gold24, 0) + " g gold";

  return (
    <div className="relative rounded-2xl p-5 mb-3 overflow-hidden" style={{ background: INK, border: `1px solid ${HAIRLINE}` }}>
      {/* ambient glow */}
      <div className="pointer-events-none absolute -top-16 -right-10 w-56 h-56 rounded-full"
           style={{ background: `radial-gradient(closest-side, ${ACCENT}33, transparent)` }} />

      <div className="relative">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] uppercase tracking-widest" style={{ fontFamily: MONO_FONT, color: MUTED_ON_DARK }}>Net worth</span>
          <button onClick={cycle} className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full"
                  style={{ fontFamily: MONO_FONT, color: ACCENT, background: ACCENT + "1A", border: `1px solid ${ACCENT}40` }}>
            {denom === "GOLD" ? "grams" : denom} · tap
          </button>
        </div>
        <button onClick={cycle} className="block text-left" aria-label={"Net worth in " + denom + ", tap to switch denomination"}>
          <div className="tabular-nums text-[2.6rem] leading-none tracking-tight truncate" style={{ fontFamily: DISPLAY_FONT, fontWeight: 600, color: "#EAF1FF" }}>{main}</div>
          <div className="tabular-nums text-sm mt-1.5" style={{ fontFamily: MONO_FONT, color: MUTED_ON_DARK }}>{sub}</div>
        </button>

        <SparkLine history={history} />

        {/* liquid / illiquid / liabilities split */}
        <div className="grid grid-cols-3 gap-3 mt-4 pt-4" style={{ borderTop: `1px solid ${HAIRLINE}` }}>
          <HeroStat label="Liquid" value={fmtEGPShort(liquidTotal)} exact={fmtEGP(liquidTotal)} color={CLASS_COLOR["Money market"]} />
          <HeroStat label="Illiquid" value={hasIlliquid ? fmtEGPShort(illiquidTotal) : "—"} exact={hasIlliquid ? fmtEGP(illiquidTotal) : undefined} color={hasIlliquid ? CLASS_COLOR.Illiquid : "#556485"} />
          <HeroStat label="Liabilities" value={liabilities ? fmtEGPShort(liabilities) : "—"} exact={liabilities ? fmtEGP(liabilities) : undefined} color={liabilities ? LIABILITY_COLOR : "#556485"} />
        </div>
      </div>

      {/* liquid allocation ribbon with target ticks */}
      <div className="relative mt-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] uppercase tracking-widest" style={{ fontFamily: MONO_FONT, color: MUTED_ON_DARK }}>Liquid allocation</span>
          <span className="text-[10px]" style={{ fontFamily: MONO_FONT, color: "#556485" }}>ticks = targets</span>
        </div>
        <div className="relative h-2.5 w-full rounded-full overflow-hidden flex" style={{ background: INK_2 }}>
          {LIQUID_CLASSES.map((c) => {
            const pct = (byClass[c] / base) * 100;
            if (pct <= 0) return null;
            return <div key={c} className="mz-bar h-full" style={{ width: pct + "%", background: CLASS_COLOR[c] }} title={`${c} ${pct.toFixed(1)}%`} />;
          })}
          {(() => {
            let acc = 0;
            return LIQUID_CLASSES.map((c) => {
              acc += targets[c] || 0;
              if (acc >= 100) return null;
              return <div key={"t" + c} className="absolute top-0 h-2.5" style={{ left: acc + "%", width: "2px", background: "rgba(234,241,255,0.55)" }} />;
            });
          })()}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5">
          {LIQUID_CLASSES.map((c) => (
            <span key={c} className="inline-flex items-center gap-1.5 text-[11px]" style={{ fontFamily: MONO_FONT, color: MUTED_ON_DARK }}>
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: CLASS_COLOR[c] }} />
              {c} {((byClass[c] / base) * 100).toFixed(0)}%
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- bottom tab bar (compact: icons only; active tab expands into a labeled pill) ---------- */
function TabBar({ tab, setTab }) {
  const items = [
    ["overview", "Overview", PieChart],
    ["accounts", "Accounts", Wallet],
    ["activity", "Activity", ArrowRightLeft],
    ["spending", "Spending", BarChart3],
    ["prices", "Prices", Coins],
  ];
  return (
    <div className="fixed bottom-0 inset-x-0 z-30 mz-bottombar"
         style={{ backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)", boxShadow: "0 -6px 24px rgba(20,35,72,0.06)" }}>
      <div className="max-w-3xl mx-auto px-3 py-1.5 flex items-center justify-between" style={{ paddingBottom: "max(6px, env(safe-area-inset-bottom))" }}>
        {items.map(([k, label, Icon]) => {
          const active = tab === k;
          return (
            <button
              key={k}
              data-active={active}
              onClick={() => setTab(k)}
              aria-label={label}
              aria-current={active ? "page" : undefined}
              className="mz-tabbtn flex items-center gap-1.5 rounded-full px-3 py-1.5"
              style={active ? { background: ACCENT + "14", color: ACCENT } : { color: "var(--muted)" }}
            >
              <Icon size={18} strokeWidth={active ? 2.3 : 1.9} className="mz-tabicon" />
              {active && <span className="mz-tablabel text-[11px] font-semibold" style={{ fontFamily: MONO_FONT }}>{label}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- rebalance: turn drift into concrete EGP moves ---------- */
function RebalanceCard({ byClass, targets, liquidTotal }) {
  const sum = LIQUID_CLASSES.reduce((s, c) => s + (targets[c] || 0), 0);
  if (sum !== 100 || liquidTotal <= 0) return null; // targets incomplete — nothing sensible to say
  const moves = LIQUID_CLASSES.map((c) => ({ c, delta: ((targets[c] || 0) / 100) * liquidTotal - (byClass[c] || 0) }));
  const maxAbs = Math.max(...moves.map((m) => Math.abs(m.delta)));
  if (maxAbs / liquidTotal < 0.02) {
    return (
      <Card>
        <div className="flex items-center justify-between">
          <CardTitle>Rebalance</CardTitle>
          <span className="text-[11px] font-mono text-teal-600">on target</span>
        </div>
        <p className="text-[12px] mz-tx2 mt-1">Every liquid class is within 2% of its target — nothing to move.</p>
      </Card>
    );
  }
  return (
    <Card>
      <div className="flex items-center justify-between">
        <CardTitle>Rebalance</CardTitle>
        <span className="text-[10px] uppercase tracking-widest" style={{ fontFamily: MONO_FONT, color: "var(--muted)" }}>to hit targets</span>
      </div>
      <div className="space-y-2 mt-3">
        {moves
          .filter((m) => Math.abs(m.delta) >= liquidTotal * 0.005)
          .sort((a, b) => b.delta - a.delta)
          .map(({ c, delta }) => {
            const Icon = CLASS_ICON[c];
            const buy = delta > 0;
            return (
              <div key={c} className="flex items-center gap-2.5">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-lg shrink-0" style={{ background: CLASS_COLOR[c] + "1F", color: CLASS_COLOR[c] }}>
                  <Icon size={13} strokeWidth={2} />
                </span>
                <span className="text-sm flex-1">{c}</span>
                <span className="font-mono tabular-nums text-sm" style={{ color: buy ? "#0d9488" : "#d97706" }}>
                  {buy ? "add " : "trim "}{fmtEGP(Math.abs(delta))}
                </span>
              </div>
            );
          })}
      </div>
      <p className="text-[11px] font-mono mz-tx3 mt-2">amounts that bring each class to its target share of your liquid portfolio</p>
    </Card>
  );
}

/* ---------- zakat: nisab check over liquid wealth ---------- */
function ZakatCard({ liquidTotal, liabilities, prices }) {
  const nisab = 85 * (prices.gold24 || 0); // 85g of pure gold, the common nisab standard
  const zakatBase = Math.max(0, liquidTotal - liabilities);
  const above = nisab > 0 && zakatBase >= nisab;
  const due = above ? zakatBase * 0.025 : 0;
  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg shrink-0" style={{ background: "#0d94881F", color: "#0d9488" }}>
            <HandHeart size={15} strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-medium">Zakat</div>
            <div className="text-[11px] font-mono mz-tx3 truncate">nisab = 85g × 24K spot = {fmtEGPShort(nisab)}</div>
          </div>
        </span>
        <div className="text-right shrink-0">
          {above ? (
            <>
              <div className="font-mono tabular-nums text-sm" style={{ color: "#0d9488" }}>{fmtEGP(due)}</div>
              <div className="text-[10px] font-mono mz-tx3">2.5% of {fmtEGPShort(zakatBase)}</div>
            </>
          ) : (
            <>
              <div className="font-mono tabular-nums text-sm mz-tx2">below nisab</div>
              <div className="text-[10px] font-mono mz-tx3">{fmtEGPShort(zakatBase)} / {fmtEGPShort(nisab)}</div>
            </>
          )}
        </div>
      </div>
      <p className="text-[11px] mz-tx3 mt-2">Simple estimate over liquid wealth minus liabilities. Hawl (a full lunar year above nisab) and asset intent still apply — treat this as a reminder, not a ruling.</p>
    </Card>
  );
}

/* ---------- overview ---------- */
function Overview({ byClass, liquidTotal, illiquidTotal, liabilities, targets, prices, fetching, onRefresh, onRefreshWeb, webBusy, webErr }) {
  const total = liquidTotal || 1;
  return (
    <div className="space-y-3">
      <Card>
        <div className="flex items-center justify-between">
          <CardTitle>Allocation vs. target</CardTitle>
          <span className="text-[10px] uppercase tracking-widest" style={{ fontFamily: MONO_FONT, color: "var(--muted)" }}>liquid only</span>
        </div>
        <div className="space-y-3 mt-3">
          {LIQUID_CLASSES.map((c) => {
            const actual = (byClass[c] / total) * 100;
            const tgt = targets[c] || 0;
            const drift = actual - tgt;
            const Icon = CLASS_ICON[c];
            return (
              <div key={c}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="inline-flex items-center gap-2">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-lg shrink-0" style={{ background: CLASS_COLOR[c] + "1F", color: CLASS_COLOR[c] }}>
                      <Icon size={13} strokeWidth={2} />
                    </span>
                    <span className="font-medium">{c}</span>
                  </span>
                  <span className="font-mono tabular-nums mz-tx2">
                    {fmtEGP(byClass[c])}
                  </span>
                </div>
                <div className="relative h-2 mz-sub2 rounded-full overflow-visible">
                  <div className="mz-bar absolute h-2 rounded-full" style={{ width: Math.min(actual, 100) + "%", background: CLASS_COLOR[c] }} />
                  <div className="absolute top-[-3px] h-3 w-0.5 rounded" style={{ left: Math.min(tgt, 100) + "%", background: INK }} />
                </div>
                <div className="flex justify-between text-[11px] font-mono mt-0.5 mz-tx3">
                  <span>{actual.toFixed(1)}% actual</span>
                  <span className={Math.abs(drift) < 3 ? "mz-tx3" : drift > 0 ? "text-amber-600" : "text-teal-600"}>
                    target {tgt}% · {fmtPct(drift)} drift
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <RebalanceCard byClass={byClass} targets={targets} liquidTotal={liquidTotal} />

      {illiquidTotal > 0 && (
        <Card>
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg" style={{ background: CLASS_COLOR.Illiquid + "1F", color: CLASS_COLOR.Illiquid }}>
                <Building2 size={15} strokeWidth={2} />
              </span>
              <div>
                <div className="text-sm font-medium">Illiquid holdings</div>
                <div className="text-[11px] font-mono mz-tx3">counted in net worth · outside the ribbon</div>
              </div>
            </span>
            <span className="font-mono tabular-nums text-sm" style={{ color: CLASS_COLOR.Illiquid }}>{fmtEGP(illiquidTotal)}</span>
          </div>
        </Card>
      )}

      <GoldCard prices={prices} fetching={fetching} onRefresh={onRefresh} onRefreshWeb={onRefreshWeb} webBusy={webBusy} webErr={webErr} />

      <ZakatCard liquidTotal={liquidTotal} liabilities={liabilities} prices={prices} />
    </div>
  );
}

function GoldCard({ prices, fetching, onRefresh, onRefreshWeb, webBusy, webErr }) {
  const karats = [24, 21, 18, 14];
  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <CardTitle>Gold spot · EGP / gram</CardTitle>
        <div className="flex gap-1.5">
          <button onClick={onRefreshWeb} disabled={webBusy} className="text-xs font-mono px-3 py-1.5 rounded-lg mz-btn-primary disabled:opacity-50">
            {webBusy ? "searching…" : "today (web)"}
          </button>
          <button onClick={onRefresh} disabled={fetching} className="text-xs font-mono px-2.5 py-1.5 rounded-lg border mz-bd mz-tx2 disabled:opacity-50">
            {fetching ? "…" : "api"}
          </button>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2 mt-3">
        {karats.map((k) => (
          <div key={k} className="mz-sub rounded-lg p-2 text-center border mz-bd">
            <div className="text-[10px] font-mono mz-tx3">{k}K</div>
            <div className="font-mono tabular-nums text-sm font-semibold" style={{ color: "#F2A93B" }}>
              {fmtNum(karatPrice(prices, k), 0)}
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between mt-3 text-[11px] font-mono mz-tx3">
        <span>USD/EGP {fmtNum(prices.usdEgp, 2)}</span>
        <span>
          {prices.source === "web"
            ? "● web"
            : prices.source === "live"
            ? "● live"
            : prices.source === "blocked"
            ? "○ manual"
            : prices.source === "partial"
            ? "◐ partial"
            : "○ seed"}{" "}
          · {timeAgo(prices.updated)}
        </span>
      </div>
      <div className="mt-1 text-[11px] font-mono">
        {(() => {
          const today = new Date().toISOString().slice(0, 10);
          const isToday = prices.priceDate === today;
          return (
            <span className={isToday ? "text-teal-600" : "text-amber-600"}>
              priced {isToday ? "today" : "as of " + (prices.priceDate || "—")}
              {prices.sourceName ? " · " + prices.sourceName : ""}
              {isToday ? "" : " (not today)"}
            </span>
          );
        })()}
      </div>
      {webErr && (
        <div className="mt-2 text-[11px] text-rose-600 border mz-note-rose rounded-lg p-2">{webErr}</div>
      )}
      {prices.source === "blocked" && !webErr && (
        <div className="mt-2 text-[11px] mz-tx2 border mz-note-amber rounded-lg p-2">
          The direct feed was blocked here. Tap "today (web)" to pull the price via web search, or set it by hand under Prices — every karat rescales from the 24K number.
        </div>
      )}
    </Card>
  );
}

/* ---------- accounts ---------- */
function Accounts({ valued, setState, prices, state }) {
  const toast = useContext(ToastCtx);
  const [editing, setEditing] = useState(null); // account or null

  function save(acc) {
    setState((s) => {
      const exists = s.accounts.some((a) => a.id === acc.id);
      return {
        ...s,
        accounts: exists ? s.accounts.map((a) => (a.id === acc.id ? acc : a)) : [...s.accounts, acc],
      };
    });
    setEditing(null);
    toast("Saved · " + (acc.name || "account"));
  }
  function remove(a) {
    const idx = state.accounts.findIndex((x) => x.id === a.id);
    const raw = state.accounts[idx]; // store the raw account, not the valued copy
    setState((s) => ({ ...s, accounts: s.accounts.filter((x) => x.id !== a.id) }));
    toast("Deleted · " + a.name, {
      undo: () =>
        setState((s) => {
          const arr = [...s.accounts];
          arr.splice(Math.min(Math.max(idx, 0), arr.length), 0, raw);
          return { ...s, accounts: arr };
        }),
    });
  }

  const grouped = {};
  CLASS_ORDER.forEach((c) => (grouped[c] = []));
  valued.forEach((a) => grouped[a.assetClass]?.push(a));

  return (
    <div className="space-y-3">
      <BalanceSync accs={valued} setState={setState} />
      <DebtLedger state={state} setState={setState} />

      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setEditing({ id: uid(), name: "", assetClass: "Cash", unit: "EGP", balance: 0 })}
          className="text-sm font-medium py-2.5 rounded-xl border border-dashed mz-bd mz-tx2 mz-hovbd mz-hovi"
        >
          + Account
        </button>
        <button
          onClick={() => setEditing({ id: uid(), name: "", assetClass: "Illiquid", unit: "EGP", balance: 0 })}
          className="inline-flex items-center justify-center gap-1.5 text-sm font-medium py-2.5 rounded-xl border border-dashed hover:opacity-80 transition-opacity"
          style={{ borderColor: CLASS_COLOR.Illiquid + "80", color: CLASS_COLOR.Illiquid }}
        >
          <Building2 size={15} strokeWidth={2} /> Illiquid asset
        </button>
      </div>

      {editing && (
        <Modal title={state.accounts.some((a) => a.id === editing.id) ? "Edit account" : "New account"} onClose={() => setEditing(null)}>
          <AccountForm initial={editing} onSave={save} onCancel={() => setEditing(null)} />
        </Modal>
      )}

      {CLASS_ORDER.map((c) => {
        const GIcon = CLASS_ICON[c];
        return grouped[c].length ? (
          <Card key={c}>
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg" style={{ background: CLASS_COLOR[c] + "1F", color: CLASS_COLOR[c] }}>
                <GIcon size={15} strokeWidth={2} />
              </span>
              <CardTitle>{c}</CardTitle>
              {c === ILLIQUID_CLASS && <span className="text-[10px] uppercase tracking-widest ml-auto" style={{ fontFamily: MONO_FONT, color: "var(--muted)" }}>outside ribbon</span>}
            </div>
            <div className="divide-y mz-dv">
              {grouped[c].map((a) => (
                <div key={a.id} className="flex items-center justify-between py-2">
                  <button onClick={() => setEditing(a)} className="text-left flex-1">
                    <div className={"text-sm font-medium " + (a.isLiability ? "text-rose-600" : "")}>{a.name}</div>
                    <div className="text-[11px] font-mono mz-tx3">
                      {a.unit === "GOLD"
                        ? `${fmtNum(a.balance)} g · ${a.karat}K`
                        : a.unit === "USD"
                        ? `$ ${fmtNum(a.balance)}`
                        : "EGP"}
                    </div>
                  </button>
                  <div className="flex items-center gap-1">
                    <div className="text-right">
                      <div className="font-mono tabular-nums text-sm" style={{ color: a.isLiability ? LIABILITY_COLOR : undefined }}>
                        {fmtEGP(a.egp)}
                      </div>
                      {!a.isLiability && a.cost > 0 && (() => {
                        const pl = a.egp - a.cost;
                        const pct = (pl / a.cost) * 100;
                        return (
                          <div className="text-[10px] font-mono tabular-nums" style={{ color: pl >= 0 ? "#0d9488" : "#e11d48" }}>
                            {(pl >= 0 ? "+" : "−") + Math.round(Math.abs(pl)).toLocaleString("en-US")} · {fmtPct(pct)}
                          </div>
                        );
                      })()}
                      {a.isLiability && a.monthlyPayment > 0 && (
                        <div className="text-[10px] font-mono mz-tx3">
                          ~{Math.max(1, Math.ceil(Math.abs(a.egp) / a.monthlyPayment))} mo at {fmtEGPShort(a.monthlyPayment)}/mo
                        </div>
                      )}
                    </div>
                    <button onClick={() => remove(a)} aria-label={"Delete " + a.name} className="mz-iconbtn mz-tx3 mz-hovrose -mr-2"><Trash2 size={15} strokeWidth={2} /></button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ) : null;
      })}
    </div>
  );
}

/* ---------- sync broker balances (Thndr) ---------- */
async function parseBalances(targets, { text, image }, ai) {
  const list = targets.map((a) => ({ id: a.id, name: a.name, unit: a.unit }));
  const instr =
    "From the note and/or screenshot of a brokerage app, read the CURRENT balance of each listed holding. " +
    `Holdings as JSON: ${JSON.stringify(list)}. ` +
    "For EGP/USD holdings give the money value; for a GOLD holding give grams. " +
    'Reply with ONLY a JSON object mapping account id to number, e.g. {"a1":338564,"a3":45725}. Omit any you cannot read. No prose, no fences.';
  const prompt = image
    ? instr + (text ? `\n\nNote: "${text}"` : "")
    : instr + `\n\nNote: "${text}"`;
  const out = await ai({ prompt, image: image || undefined });
  const m = out.replace(/```json/g, "").replace(/```/g, "").match(/\{[\s\S]*\}/);
  if (!m) throw new Error("no-json");
  const obj = JSON.parse(m[0]);
  const result = {};
  Object.keys(obj).forEach((k) => {
    const n = Number(obj[k]);
    if (targets.some((a) => a.id === k) && isFinite(n)) result[k] = n;
  });
  return result;
}

function localParseBalances(targets, text) {
  const t = text.toLowerCase();
  const result = {};
  targets.forEach((a) => {
    const toks = a.name
      .toLowerCase()
      .replace(/[()—\-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !["the", "fund"].includes(w));
    for (const tok of toks) {
      const re = new RegExp(tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[^\\d]{0,14}(\\d[\\d,\\.]*)\\s*(k)?", "i");
      const mm = t.match(re);
      if (mm) {
        let n = parseFloat(mm[1].replace(/,/g, "")) || 0;
        if (mm[2]) n *= 1000;
        if (n) {
          result[a.id] = n;
          break;
        }
      }
    }
  });
  return result;
}

function DebtLedger({ state, setState }) {
  const toast = useContext(ToastCtx);
  const debts = state.debts || [];
  const [open, setOpen] = useState(false);
  const [dir, setDir] = useState("owed");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const receivable = debts.filter((d) => d.dir === "owed").reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const payable = debts.filter((d) => d.dir === "owe").reduce((s, d) => s + (Number(d.amount) || 0), 0);

  function add() {
    const amt = Number(amount) || 0;
    if (!amt) return;
    const d = { id: uid(), dir, name: name.trim() || (dir === "owed" ? "Owed to me" : "I owe"), amount: amt, note: note.trim(), date: new Date().toISOString().slice(0, 10) };
    setState((s) => ({ ...s, debts: [d, ...(s.debts || [])] }));
    setName("");
    setAmount("");
    setNote("");
    toast("Debt logged · " + d.name + " " + fmtEGPShort(amt));
  }
  function settle(d) {
    const idx = debts.findIndex((x) => x.id === d.id);
    setState((s) => ({ ...s, debts: (s.debts || []).filter((x) => x.id !== d.id) }));
    toast("Settled · " + d.name + " " + fmtEGPShort(d.amount), {
      undo: () =>
        setState((s) => {
          const arr = [...(s.debts || [])];
          arr.splice(Math.min(Math.max(idx, 0), arr.length), 0, d);
          return { ...s, debts: arr };
        }),
    });
  }

  return (
    <Card>
      <div className="flex items-center justify-between">
        <CardTitle>Debts</CardTitle>
        <button onClick={() => setOpen((o) => !o)} className="text-xs font-mono px-3 py-1.5 rounded-lg mz-btn-primary">{open ? "close" : "log"}</button>
      </div>
      <div className="flex gap-5 mt-2 text-xs font-mono">
        <span className="mz-tx3">owed to me <span className="text-teal-600">{fmtEGP(receivable)}</span></span>
        <span className="mz-tx3">I owe <span className="text-rose-600">{fmtEGP(payable)}</span></span>
      </div>

      {open && (
        <div className="mt-3 space-y-2">
          <div className="flex gap-1 mz-sub rounded-lg p-1">
            {[["owed", "Owed to me"], ["owe", "I owe"]].map(([k, l]) => (
              <button key={k} onClick={() => setDir(k)} className={"flex-1 text-xs font-medium py-1.5 rounded-md " + (dir === k ? "mz-segon shadow-sm" : "mz-tx2")}>{l}</button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Counterparty"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ahmed" /></Field>
            <Field label="Amount (EGP)"><input type="number" className={inputCls + " font-mono"} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          </div>
          <Field label="Note"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional — what it's for" /></Field>
          <button onClick={add} className="w-full mz-btn-primary text-sm font-medium py-2 rounded-lg">Add debt</button>
        </div>
      )}

      {debts.length > 0 && (
        <div className="divide-y mz-dv mt-3">
          {debts.map((d) => (
            <div key={d.id} className="flex items-center justify-between py-2 gap-2">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">
                  {d.name}
                  <span className="text-[10px] font-mono uppercase ml-2" style={{ color: d.dir === "owed" ? "#0d9488" : "#e11d48" }}>{d.dir === "owed" ? "owed to me" : "I owe"}</span>
                </div>
                <div className="text-[11px] font-mono mz-tx3 truncate">{d.date}{d.note ? " · " + d.note : ""}</div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <span className="font-mono tabular-nums text-sm" style={{ color: d.dir === "owed" ? "#0d9488" : "#e11d48" }}>{fmtEGP(d.amount)}</span>
                <button onClick={() => settle(d)} aria-label={"Settle " + d.name} className="mz-iconbtn mz-tx3 mz-txteal inline-flex items-center gap-1 -mr-2">
                  <Check size={15} strokeWidth={2.2} /><span className="text-[11px] font-mono">settle</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function BalanceSync({ accs, setState }) {
  const toast = useContext(ToastCtx);
  const callAI = useContext(AICtx);
  const hasThndr = accs.some((a) => (a.broker || "").toLowerCase() === "thndr");
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState(hasThndr ? "thndr" : "all");
  const [draft, setDraft] = useState({});
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const fileRef = useRef(null);

  const targets = (scope === "thndr" ? accs.filter((a) => (a.broker || "").toLowerCase() === "thndr") : accs.filter((a) => !a.isLiability));

  useEffect(() => {
    const d = {};
    targets.forEach((a) => (d[a.id] = String(a.balance)));
    setDraft(d);
    setMsg(null);
    // eslint-disable-next-line
  }, [open, scope]);

  function fileToImage(file, cb) {
    if (!file || !/^image\//.test(file.type)) {
      setMsg("That file isn't an image.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const mm = /^data:(.+);base64,(.*)$/.exec(String(reader.result));
      if (mm) cb({ media: mm[1], data: mm[2] });
    };
    reader.readAsDataURL(file);
  }

  function applyParsed(map) {
    setDraft((d) => {
      const nd = { ...d };
      Object.keys(map).forEach((id) => (nd[id] = String(map[id])));
      return nd;
    });
  }

  async function runParse(image) {
    setBusy(true);
    setMsg(null);
    try {
      const map = await withTimeout(parseBalances(targets, { text: text.trim(), image }, callAI), 30000);
      if (!Object.keys(map).length) throw new Error("empty");
      applyParsed(map);
      setMsg("Read " + Object.keys(map).length + " balance(s) — check, then Apply.");
    } catch (e) {
      if (!image && text.trim()) {
        const map = localParseBalances(targets, text.trim());
        if (Object.keys(map).length) {
          applyParsed(map);
          setMsg("Claude wasn't reachable; matched " + Object.keys(map).length + " offline — check, then Apply.");
        } else {
          setMsg("Couldn't match any balances. Type them like: clouds 338564, azg 45725, bwa 9762");
        }
      } else {
        setMsg("Reading a screenshot needs an AI provider — add a Gemini key in Settings (or run inside Claude.ai). Type the balances instead.");
      }
    }
    setBusy(false);
  }

  function applyDraft() {
    const updates = {};
    targets.forEach((a) => {
      const v = Number(draft[a.id]);
      if (isFinite(v)) updates[a.id] = v;
    });
    setState((s) => ({ ...s, accounts: s.accounts.map((a) => (updates[a.id] != null ? { ...a, balance: updates[a.id] } : a)) }));
    setOpen(false);
    toast("Updated " + Object.keys(updates).length + " balances");
  }

  return (
    <Card>
      <div className="flex items-center justify-between">
        <CardTitle>Update balances</CardTitle>
        <button onClick={() => setOpen((o) => !o)} className="text-xs font-mono px-3 py-1.5 rounded-lg mz-btn-primary">
          {open ? "close" : "sync"}
        </button>
      </div>
      {!open ? (
        <p className="text-[12px] mz-tx2 mt-1">Refresh balances in bulk from a screenshot (e.g. your Thndr portfolio), or by typing them — instead of editing each account by hand.</p>
      ) : (
        <div className="mt-3 space-y-3">
          {hasThndr && (
            <div className="flex gap-1 mz-sub rounded-lg p-1">
              {[["thndr", "Thndr"], ["all", "All accounts"]].map(([k, l]) => (
                <button key={k} onClick={() => setScope(k)} className={"flex-1 text-xs font-medium py-1.5 rounded-md " + (scope === k ? "mz-segon shadow-sm" : "mz-tx2")}>{l}</button>
              ))}
            </div>
          )}
          <div>
            <textarea
              rows={2}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="paste/type: clouds 338564, wallet 48520, azg 45725, bwa 9762, fnar 58"
              className="w-full mz-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 resize-none"
            />
            <div className="flex items-center gap-2 mt-2">
              <button onClick={() => fileRef.current && fileRef.current.click()} className="text-xs font-mono px-3 py-1.5 rounded-lg border mz-bd mz-tx2">📷 screenshot</button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => fileToImage(e.target.files && e.target.files[0], (img) => runParse(img))} />
              <button onClick={() => runParse(null)} disabled={busy} className="flex-1 text-sm font-medium px-3 py-2 rounded-lg mz-btn-primary disabled:opacity-50">
                {busy ? "reading…" : "Read into fields"}
              </button>
            </div>
            {msg && <div className="mt-2 text-[11px] mz-tx2 border mz-note-mut rounded-lg p-2">{msg}</div>}
          </div>
          <div className="divide-y mz-dv max-h-72 overflow-auto">
            {targets.map((a) => (
              <div key={a.id} className="flex items-center justify-between py-2 gap-2">
                <span className="text-sm flex-1 truncate">
                  {a.name}
                  <span className="text-[11px] font-mono mz-tx3 ml-1">{a.unit === "GOLD" ? "(g)" : a.unit === "USD" ? "($)" : "(EGP)"}</span>
                </span>
                <input
                  type="number"
                  className="w-32 font-mono text-right mz-input rounded-lg px-2 py-1 text-sm"
                  value={draft[a.id] ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, [a.id]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          <button onClick={applyDraft} className="w-full mz-btn-primary text-sm font-medium py-2 rounded-lg">Apply to {targets.length} accounts</button>
        </div>
      )}
    </Card>
  );
}

function AccountForm({ initial, onSave, onCancel }) {
  const [f, setF] = useState({ ...initial });
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  return (
    <div>
      <div className="space-y-2">
        <Field label="Name">
          <input className={inputCls} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. NBE savings" />
        </Field>
        <Field label="Asset class">
          <select className={inputCls} value={f.assetClass} onChange={(e) => set("assetClass", e.target.value)}>
            {CLASS_ORDER.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Held in">
          <select className={inputCls} value={f.unit} onChange={(e) => set("unit", e.target.value)}>
            <option value="EGP">EGP</option>
            <option value="USD">US dollars</option>
            <option value="GOLD">Physical gold (grams)</option>
          </select>
        </Field>
        {f.unit === "GOLD" && (
          <Field label="Karat">
            <select className={inputCls} value={f.karat || 21} onChange={(e) => set("karat", Number(e.target.value))}>
              {[24, 21, 18, 14].map((k) => <option key={k} value={k}>{k}K</option>)}
            </select>
          </Field>
        )}
        <Field label={f.unit === "GOLD" ? "Weight (grams)" : f.unit === "USD" ? "Balance ($)" : "Balance (EGP)"}>
          <input type="number" className={inputCls + " font-mono"} value={f.balance} onChange={(e) => set("balance", Number(e.target.value))} />
        </Field>
        <Field label="Held at (broker, optional)">
          <input className={inputCls} value={f.broker || ""} onChange={(e) => set("broker", e.target.value)} placeholder="e.g. Thndr" />
        </Field>
        {!f.isLiability && ["Gold", "Equity", "Illiquid"].includes(f.assetClass) && (
          <Field label="Cost basis (EGP, optional)">
            <input type="number" className={inputCls + " font-mono"} value={f.cost ?? ""} placeholder="what you paid, total"
                   onChange={(e) => set("cost", e.target.value === "" ? undefined : Number(e.target.value))} />
          </Field>
        )}
        <label className="flex items-center gap-2 text-sm mz-tx2 pt-1">
          <input type="checkbox" checked={!!f.isLiability} onChange={(e) => set("isLiability", e.target.checked)} />
          This is a liability (debt / card balance)
        </label>
        {f.isLiability && (
          <Field label="Monthly payment (EGP, optional)">
            <input type="number" className={inputCls + " font-mono"} value={f.monthlyPayment ?? ""} placeholder="installment per month"
                   onChange={(e) => set("monthlyPayment", e.target.value === "" ? undefined : Number(e.target.value))} />
          </Field>
        )}
        <div className="flex gap-2 pt-2">
          <button onClick={() => f.name && onSave(f)} className="flex-1 mz-btn-primary text-sm font-medium py-2 rounded-lg">Save</button>
          <button onClick={onCancel} className="px-4 text-sm mz-tx2">Cancel</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- spending analysis ---------- */
function monthLabel(m) {
  try {
    const d = new Date(m + "-01");
    return d.toLocaleString("en", { month: "short" }) + " " + String(d.getFullYear()).slice(2);
  } catch {
    return m;
  }
}

function Budgets({ state, setState, prices }) {
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState({});
  const budgets = state.budgets || {};
  const ym = new Date().toISOString().slice(0, 7);
  const accById = (id) => state.accounts.find((a) => a.id === id);
  const rate = (acc) => (!acc ? 1 : acc.unit === "USD" ? prices.usdEgp : acc.unit === "GOLD" ? karatPrice(prices, acc.karat || 24) : 1);

  const spent = {};
  state.transactions
    .filter((t) => t.type === "expense" && (t.date || "").slice(0, 7) === ym)
    .forEach((t) => {
      const c = t.category || "Uncategorized";
      spent[c] = (spent[c] || 0) + (Number(t.fromAmount) || 0) * rate(accById(t.fromId));
    });

  const cats = Array.from(new Set([...Object.keys(budgets), ...Object.keys(spent)]))
    .filter((c) => budgets[c] || spent[c])
    .sort((a, b) => (budgets[b] ? spent[b] / budgets[b] : 0) - (budgets[a] ? spent[a] / budgets[a] : 0));

  function openEdit() {
    const d = {};
    Object.keys(budgets).forEach((c) => (d[c] = String(budgets[c])));
    setDraft(d);
    setEdit(true);
  }
  function save() {
    const nb = {};
    Object.keys(draft).forEach((c) => {
      const v = Number(draft[c]);
      if (v > 0) nb[c] = v;
    });
    setState((s) => ({ ...s, budgets: nb }));
    setEdit(false);
  }

  const status = (r) => (r > 1 ? { c: "#e11d48", label: "over" } : r >= 0.8 ? { c: "#d97706", label: "close" } : { c: "#0d9488", label: "on track" });

  return (
    <Card>
      <div className="flex items-center justify-between">
        <CardTitle>Monthly budgets · {monthLabel(ym)}</CardTitle>
        <button onClick={() => (edit ? setEdit(false) : openEdit())} className="text-xs font-mono px-3 py-1.5 rounded-lg border mz-bd mz-tx2">
          {edit ? "cancel" : "set budgets"}
        </button>
      </div>

      {edit ? (
        <div className="mt-3 space-y-2">
          <p className="text-[11px] mz-tx3 font-mono">Monthly cap per category (EGP). Leave blank for no limit.</p>
          {MAIN_CATS.filter((c) => c !== "Income").map((c) => (
            <div key={c} className="flex items-center gap-3">
              <span className="text-sm flex-1">{c}</span>
              <input
                type="number"
                placeholder="—"
                className="w-28 font-mono text-right mz-input rounded-lg px-2 py-1 text-sm"
                value={draft[c] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [c]: e.target.value }))}
              />
            </div>
          ))}
          <button onClick={save} className="w-full mz-btn-primary text-sm font-medium py-2 rounded-lg mt-1">Save budgets</button>
        </div>
      ) : cats.length === 0 ? (
        <p className="text-[12px] mz-tx2 mt-2">No budgets yet. Tap “set budgets” to cap spending per category — you'll get a warning as you near each cap, and when you log an expense that crosses it.</p>
      ) : (
        <div className="space-y-2.5 mt-3">
          {cats.map((c) => {
            const b = budgets[c];
            const sp = spent[c] || 0;
            if (!b) {
              return (
                <div key={c} className="flex items-center justify-between text-sm">
                  <span className="font-medium">{c}</span>
                  <span className="font-mono tabular-nums mz-tx3">{fmtEGP(sp)} · no cap</span>
                </div>
              );
            }
            const r = sp / b;
            const st = status(r);
            return (
              <div key={c}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="font-medium">
                    {c} <span className="text-[10px] font-mono uppercase ml-1" style={{ color: st.c }}>{st.label}</span>
                  </span>
                  <span className="font-mono tabular-nums mz-tx2">{fmtEGP(sp)} / {fmtEGP(b)}</span>
                </div>
                <div className="h-2 mz-sub2 rounded-full overflow-hidden">
                  <div className="h-2 rounded-full" style={{ width: Math.min(r * 100, 100) + "%", background: st.c }} />
                </div>
                {r >= 0.8 && (
                  <div className="text-[11px] font-mono mt-0.5" style={{ color: st.c }}>
                    {r > 1 ? `over by ${fmtEGP(sp - b)}` : `${Math.round(r * 100)}% used · ${fmtEGP(b - sp)} left`}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function Spending({ state, setState, prices }) {
  const [month, setMonth] = useState(null);
  const [cat, setCat] = useState(null);
  const accById = (id) => state.accounts.find((a) => a.id === id);
  const rate = (acc) => (!acc ? 1 : acc.unit === "USD" ? prices.usdEgp : acc.unit === "GOLD" ? karatPrice(prices, acc.karat || 24) : 1);

  const expenses = state.transactions
    .filter((t) => t.type === "expense")
    .map((t) => ({ ...t, egp: (Number(t.fromAmount) || 0) * rate(accById(t.fromId)), ym: (t.date || "").slice(0, 7) }))
    .filter((e) => e.ym);
  const incomes = state.transactions
    .filter((t) => t.type === "income")
    .map((t) => ({ egp: (Number(t.toAmount) || 0) * rate(accById(t.toId)), ym: (t.date || "").slice(0, 7) }))
    .filter((e) => e.ym);

  if (expenses.length === 0) {
    return (
      <div className="space-y-3">
        <Budgets state={state} setState={setState} prices={prices} />
        <Card>
          <CardTitle>Spending</CardTitle>
          <div className="text-sm mz-tx3 py-8 text-center">
            No expenses logged yet. Once you record some under Activity, they'll break down here by category and by month.
          </div>
        </Card>
      </div>
    );
  }

  const months = Array.from(new Set(expenses.map((e) => e.ym))).sort();
  const monthTotals = months.map((m) => ({ m, total: expenses.filter((e) => e.ym === m).reduce((s, e) => s + e.egp, 0) }));
  const maxMonth = Math.max(...monthTotals.map((x) => x.total), 1);

  const scope = month ? expenses.filter((e) => e.ym === month) : expenses;
  const scopeTotal = scope.reduce((s, e) => s + e.egp, 0);

  // main categories, or subcategories when one is drilled into
  const drill = cat != null;
  const buckets = {};
  (drill ? scope.filter((e) => (e.category || "Uncategorized") === cat) : scope).forEach((e) => {
    const key = drill ? e.subcategory || "(unspecified)" : e.category || "Uncategorized";
    buckets[key] = (buckets[key] || 0) + e.egp;
  });
  const rows = Object.entries(buckets).sort((a, b) => b[1] - a[1]);
  const maxRow = rows.length ? rows[0][1] : 1;
  const rowsTotal = rows.reduce((s, r) => s + r[1], 0) || 1;

  return (
    <div className="space-y-3">
      <Budgets state={state} setState={setState} prices={prices} />
      <Card>
        <div className="flex items-baseline justify-between">
          <CardTitle>By month</CardTitle>
          <span className="font-mono tabular-nums text-sm">{fmtEGP(scopeTotal)}{month ? "" : " total"}</span>
        </div>
        <div className="flex items-end gap-2 h-36 mt-4">
          {monthTotals.map(({ m, total }) => {
            const sel = month === m;
            return (
              <button key={m} onClick={() => setMonth(sel ? null : m)} className="flex-1 flex flex-col items-center justify-end h-full group">
                <span className="font-mono text-[10px] mz-tx3 mb-1">{Math.round(total / 1000)}k</span>
                <div
                  className="w-full rounded-t-md transition-all"
                  style={{ height: Math.max((total / maxMonth) * 100, 3) + "%", background: sel ? ACCENT : "#CBD5E1" }}
                />
                <span className={"font-mono text-[10px] mt-1 " + (sel ? "font-semibold" : "mz-tx3")} style={sel ? { color: ACCENT } : undefined}>{monthLabel(m)}</span>
              </button>
            );
          })}
        </div>
        <div className="text-[11px] font-mono mz-tx3 mt-3 text-center">
          {month ? "showing " + monthLabel(month) + " · tap again for all months" : "tap a bar to drill into one month"}
        </div>
      </Card>

      {(() => {
        const cfMonths = Array.from(new Set([...expenses.map((e) => e.ym), ...incomes.map((i) => i.ym)])).sort().slice(-6).reverse();
        if (!cfMonths.length) return null;
        return (
          <Card>
            <CardTitle>Cashflow · income vs. spend</CardTitle>
            <div className="divide-y mz-dv mt-1">
              {cfMonths.map((m) => {
                const inc = incomes.filter((i) => i.ym === m).reduce((s, i) => s + i.egp, 0);
                const out = expenses.filter((e) => e.ym === m).reduce((s, e) => s + e.egp, 0);
                const netM = inc - out;
                return (
                  <div key={m} className="flex items-center justify-between py-2 text-sm">
                    <span className="font-mono mz-tx2 w-16">{monthLabel(m)}</span>
                    <span className="font-mono tabular-nums text-[12px]" style={{ color: "#0d9488" }}>+{fmtEGPShort(inc).replace("EGP ", "")}</span>
                    <span className="font-mono tabular-nums text-[12px]" style={{ color: "#e11d48" }}>−{fmtEGPShort(out).replace("EGP ", "")}</span>
                    <span className="font-mono tabular-nums font-semibold" style={{ color: netM >= 0 ? "#0d9488" : "#e11d48" }}>
                      {netM >= 0 ? "+" : "−"}{fmtEGPShort(Math.abs(netM)).replace("EGP ", "")}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="text-[10px] font-mono mz-tx3 mt-2 text-right">in · out · net (EGP)</div>
          </Card>
        );
      })()}

      <Card>
        <div className="flex items-baseline justify-between">
          <CardTitle>
            {drill ? (
              <button onClick={() => setCat(null)} className="mz-tx1 normal-case tracking-normal">
                <span className="mz-tx3">‹ categories /</span> {cat}
              </button>
            ) : (
              <>By category{month ? " · " + monthLabel(month) : ""}</>
            )}
          </CardTitle>
          <span className="font-mono tabular-nums text-sm mz-tx2">{drill ? "subcategories" : rows.length + " categories"}</span>
        </div>
        <div className="space-y-2.5 mt-3">
          {rows.map(([c, v]) => {
            const clickable = !drill; // tap a main category to open its subcategories
            const Tag = clickable ? "button" : "div";
            const Icon = clickable ? catIcon(c) : null;
            return (
              <Tag key={c} onClick={clickable ? () => setCat(c) : undefined} className={"block w-full text-left" + (clickable ? " group" : "")}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="inline-flex items-center gap-2 font-medium">
                    {Icon && (
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-lg shrink-0" style={{ background: ACCENT + "14", color: ACCENT }}>
                        <Icon size={13} strokeWidth={2} />
                      </span>
                    )}
                    {c}
                    {clickable && <span className="ml-0.5 mz-tx3 group-mz-hovm">›</span>}
                  </span>
                  <span className="font-mono tabular-nums mz-tx2">
                    {fmtEGP(v)} <span className="mz-tx3">· {((v / rowsTotal) * 100).toFixed(0)}%</span>
                  </span>
                </div>
                <div className="h-2 mz-sub2 rounded-full overflow-hidden">
                  <div className="mz-bar h-2 rounded-full" style={{ width: Math.max((v / maxRow) * 100, 2) + "%", background: drill ? CLASS_COLOR["Money market"] : ACCENT }} />
                </div>
              </Tag>
            );
          })}
        </div>
        {!drill && <div className="text-[11px] font-mono mz-tx3 mt-3 text-center">tap a category to see its subcategories</div>}
      </Card>
    </div>
  );
}

/* ---------- activity ---------- */
function Activity({ state, setState, prices, focusSignal }) {
  const toast = useContext(ToastCtx);
  const [open, setOpen] = useState(false);
  const [parsed, setParsed] = useState(null);
  const [formKey, setFormKey] = useState(0);
  const [pending, setPending] = useState([]);
  const [warn, setWarn] = useState([]);
  const accs = state.accounts;
  const accById = (id) => accs.find((a) => a.id === id);

  function applyDelta(accounts, id, delta) {
    return accounts.map((a) => (a.id === id ? { ...a, balance: a.balance + delta } : a));
  }

  // after committing expense(s), warn if any touched category nears/exceeds its monthly budget
  function checkBudgets(committed) {
    const budgets = state.budgets || {};
    const ym = new Date().toISOString().slice(0, 7);
    const rate = (acc) => (!acc ? 1 : acc.unit === "USD" ? prices.usdEgp : acc.unit === "GOLD" ? karatPrice(prices, acc.karat || 24) : 1);
    const exp = committed.filter((t) => t.type === "expense" && (t.date || "").slice(0, 7) === ym);
    if (!exp.length) return;
    const touched = new Set(exp.map((t) => t.category || "Uncategorized"));
    const all = [...committed, ...state.transactions].filter((t) => t.type === "expense" && (t.date || "").slice(0, 7) === ym);
    const spentBy = {};
    all.forEach((t) => {
      const c = t.category || "Uncategorized";
      spentBy[c] = (spentBy[c] || 0) + (Number(t.fromAmount) || 0) * rate(accById(t.fromId));
    });
    const msgs = [];
    touched.forEach((c) => {
      const b = budgets[c];
      if (!b) return;
      const r = (spentBy[c] || 0) / b;
      if (r > 1) msgs.push(`${c}: over budget — ${fmtEGP(spentBy[c])} of ${fmtEGP(b)} this month`);
      else if (r >= 0.8) msgs.push(`${c}: ${Math.round(r * 100)}% of ${fmtEGP(b)} budget — ${fmtEGP(b - spentBy[c])} left`);
    });
    if (msgs.length) setWarn(msgs);
  }

  // fill in toAmount sensibly (same-unit transfer mirrors fromAmount; income uses given amount)
  function normalize(t0) {
    const from = accById(t0.fromId);
    const to = accById(t0.toId);
    const sameUnit = from && to && from.unit === to.unit;
    const fa = Number(t0.fromAmount) || 0;
    let ta;
    if (t0.type === "income") ta = Number(t0.toAmount != null ? t0.toAmount : t0.fromAmount) || 0;
    else if (t0.type === "transfer") ta = t0.toAmount != null ? Number(t0.toAmount) : sameUnit ? fa : 0;
    else ta = fa;
    return {
      id: uid(),
      date: t0.date || new Date().toISOString().slice(0, 10),
      type: t0.type,
      fromId: t0.type === "income" ? null : t0.fromId,
      toId: t0.type === "expense" ? null : t0.toId,
      fromAmount: fa,
      toAmount: ta,
      category: t0.category || "",
      subcategory: t0.subcategory || "",
      note: t0.note || "",
    };
  }

  function applyTxn(accounts, t) {
    if (t.type === "income") return applyDelta(accounts, t.toId, t.toAmount);
    if (t.type === "expense") return applyDelta(accounts, t.fromId, -t.fromAmount);
    return applyDelta(applyDelta(accounts, t.fromId, -t.fromAmount), t.toId, t.toAmount);
  }
  function reverseTxn(accounts, t) {
    if (t.type === "income") return applyDelta(accounts, t.toId, -t.toAmount);
    if (t.type === "expense") return applyDelta(accounts, t.fromId, t.fromAmount);
    return applyDelta(applyDelta(accounts, t.fromId, t.fromAmount), t.toId, -t.toAmount);
  }

  const [editTxn, setEditTxn] = useState(null);
  function txnLabel(t) {
    const from = accById(t.fromId), to = accById(t.toId);
    if (t.type === "income") return "+" + fmtNum(t.toAmount, 0) + unitLabel(to);
    if (t.type === "expense") return "−" + fmtNum(t.fromAmount, 0) + unitLabel(from);
    return "transfer";
  }
  function commitEdit(nt) {
    const old = editTxn;
    setState((s) => {
      let accounts = reverseTxn(s.accounts, old);
      accounts = applyTxn(accounts, nt);
      return { ...s, accounts, transactions: s.transactions.map((x) => (x.id === old.id ? nt : x)) };
    });
    setEditTxn(null);
    checkBudgets([nt]);
    toast("Updated · " + (nt.category || nt.type) + " " + txnLabel(nt));
  }

  function addTxn(t) {
    setState((s) => ({ ...s, accounts: applyTxn(s.accounts, t), transactions: [t, ...s.transactions] }));
    setOpen(false);
    setParsed(null);
    checkBudgets([t]);
    toast("Logged · " + (t.category || (t.type === "transfer" ? "Transfer" : t.type)) + " " + txnLabel(t));
  }
  function addMany(list) {
    const norm = list.map(normalize);
    setState((s) => {
      let accounts = s.accounts;
      norm.forEach((t) => (accounts = applyTxn(accounts, t)));
      return { ...s, accounts, transactions: [...norm.slice().reverse(), ...s.transactions] };
    });
    setPending([]);
    checkBudgets(norm);
    toast("Logged " + norm.length + " transactions");
  }
  function delTxn(t) {
    const idx = state.transactions.findIndex((x) => x.id === t.id);
    setState((s) => ({ ...s, accounts: reverseTxn(s.accounts, t), transactions: s.transactions.filter((x) => x.id !== t.id) }));
    toast("Deleted · " + (t.category || t.type) + " " + txnLabel(t), {
      undo: () =>
        setState((s) => {
          const txs = [...s.transactions];
          txs.splice(Math.min(Math.max(idx, 0), txs.length), 0, t);
          return { ...s, accounts: applyTxn(s.accounts, t), transactions: txs };
        }),
    });
  }

  function onParsed(fields) {
    const list = Array.isArray(fields) ? fields : [fields];
    if (list.length <= 1) {
      setParsed(list[0] || null);
      setFormKey((k) => k + 1);
      setOpen(true);
      setPending([]);
    } else {
      setPending(list.map((f) => ({ ...f, _k: uid() })));
      setOpen(false);
      setParsed(null);
    }
  }
  function editPending(p) {
    setParsed(p);
    setFormKey((k) => k + 1);
    setOpen(true);
    setPending((list) => list.filter((x) => x._k !== p._k));
  }
  function manualToggle() {
    setParsed(null);
    setFormKey((k) => k + 1);
    setOpen(true); // closing is the modal's job (X, backdrop, or Escape)
  }

  return (
    <div className="space-y-3">
      {warn.length > 0 && (
        <div className="rounded-xl border mz-note-amber p-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono uppercase tracking-widest mz-txamber">⚠ budget alert</span>
            <button onClick={() => setWarn([])} className="text-[11px] font-mono text-amber-600">dismiss</button>
          </div>
          <div className="mt-1 space-y-0.5">
            {warn.map((w, i) => (
              <div key={i} className="text-sm mz-txamber2">{w}</div>
            ))}
          </div>
        </div>
      )}
      <QuickAdd accs={accs} onParsed={onParsed} focusSignal={focusSignal} />

      {pending.length > 0 && (
        <Card>
          <div className="flex items-center justify-between">
            <CardTitle>Review {pending.length} parsed</CardTitle>
            <button onClick={() => setPending([])} className="text-[11px] font-mono mz-tx3 hover:text-rose-500">discard all</button>
          </div>
          <div className="divide-y mz-dv mt-1">
            {pending.map((p) => {
              const from = accById(p.fromId);
              const to = accById(p.toId);
              const needsAmt = !p.fromAmount && !p.toAmount;
              const amt =
                p.type === "income"
                  ? `+${fmtNum(p.toAmount || 0, 2)}${unitLabel(to)}`
                  : p.type === "transfer"
                  ? `${fmtNum(p.fromAmount || 0, 2)}${unitLabel(from)} → ${p.toAmount != null ? fmtNum(p.toAmount, 2) + unitLabel(to) : "?"}`
                  : `−${fmtNum(p.fromAmount || 0, 2)}${unitLabel(from)}`;
              return (
                <div key={p._k} className="flex items-center justify-between py-2 gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {p.category || (p.type === "transfer" ? "Transfer" : p.type)}
                      {p.subcategory ? <span className="mz-tx3 font-normal"> · {p.subcategory}</span> : null}
                      {needsAmt && <span className="ml-2 text-[10px] font-mono text-amber-600">needs amount</span>}
                    </div>
                    <div className="text-[11px] font-mono mz-tx3 truncate">
                      {p.date} · {p.type === "income" ? `→ ${to?.name}` : p.type === "expense" ? `${from?.name} →` : `${from?.name} → ${to?.name}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono tabular-nums text-sm">{amt}</span>
                    <button onClick={() => editPending(p)} aria-label="Edit parsed item" className="mz-iconbtn mz-tx2 mz-hovblue"><Pencil size={14} strokeWidth={2} /></button>
                    <button onClick={() => setPending((l) => l.filter((x) => x._k !== p._k))} aria-label="Discard parsed item" className="mz-iconbtn mz-tx3 mz-hovrose"><X size={15} strokeWidth={2} /></button>
                  </div>
                </div>
              );
            })}
          </div>
          <button onClick={() => addMany(pending)} className="w-full mt-3 mz-btn-primary text-sm font-medium py-2 rounded-lg">
            Add all {pending.length}
          </button>
        </Card>
      )}

      <button onClick={manualToggle} className="w-full text-sm font-medium py-2.5 rounded-xl border mz-bd mz-tx2 mz-hovi">
        Or fill it in by hand
      </button>
      {open && (
        <Modal title={parsed ? "Review parsed entry" : "Log manually"} onClose={() => { setOpen(false); setParsed(null); }}>
          {parsed && (
            <div className="text-[11px] font-mono mz-txteal border mz-note-teal rounded-lg px-3 py-2 mb-3">
              Parsed from your note — check the fields and save.
            </div>
          )}
          <TxnForm key={formKey} accs={accs} onAdd={addTxn} initial={parsed || {}} />
        </Modal>
      )}

      {editTxn && (
        <Modal title="Edit transaction" onClose={() => setEditTxn(null)}>
          <div className="text-[11px] font-mono mz-txblue border mz-note-blue rounded-lg px-3 py-2 mb-3">
            Balances re-apply on save — the old amounts are reversed first.
          </div>
          <TxnForm key={"edit-" + editTxn.id} accs={accs} onAdd={commitEdit} initial={editTxn} />
        </Modal>
      )}

      <Card>
        <CardTitle>Recent activity</CardTitle>
        {state.transactions.length === 0 ? (
          <div className="text-sm mz-tx3 py-6 text-center">
            Nothing logged yet. A transfer moves value between accounts — use it for a gold buy (EGP out → grams in) or an FX swap, the part Wallet made you fake.
          </div>
        ) : (
          <div className="divide-y mz-dv mt-1">
            {state.transactions.map((t) => {
              const from = accById(t.fromId);
              const to = accById(t.toId);
              const color = t.type === "income" ? "#0d9488" : t.type === "expense" ? "#e11d48" : "#475569";
              const RIcon = t.type === "transfer" ? ArrowRightLeft : t.type === "income" ? ArrowDownToLine : catIcon(t.category);
              return (
                <div key={t.id} className="flex items-center justify-between py-2 gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg shrink-0" style={{ background: color + "16", color }}>
                      <RIcon size={15} strokeWidth={2} />
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{t.category || (t.type === "transfer" ? "Transfer" : t.type)}{t.subcategory ? <span className="mz-tx3 font-normal"> · {t.subcategory}</span> : null}</div>
                      <div className="text-[11px] font-mono mz-tx3 truncate">
                        {t.date} ·{" "}
                        {t.type === "income"
                          ? `→ ${to?.name}`
                          : t.type === "expense"
                          ? `${from?.name} →`
                          : `${from?.name} → ${to?.name}`}
                        {t.note ? ` · ${t.note}` : ""}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono tabular-nums text-sm" style={{ color }}>
                      {t.type === "transfer"
                        ? `${fmtNum(t.fromAmount, 2)}${unitLabel(from)} → ${fmtNum(t.toAmount, 2)}${unitLabel(to)}`
                        : t.type === "income"
                        ? `+${fmtNum(t.toAmount, 2)}${unitLabel(to)}`
                        : `−${fmtNum(t.fromAmount, 2)}${unitLabel(from)}`}
                    </div>
                    <div className="flex items-center justify-end gap-0.5 -mr-2">
                      <button onClick={() => { setEditTxn(t); setOpen(false); setParsed(null); }} aria-label="Edit transaction" className="mz-iconbtn mz-tx3 mz-hovblue"><Pencil size={15} strokeWidth={2} /></button>
                      <button onClick={() => delTxn(t)} aria-label="Delete transaction" className="mz-iconbtn mz-tx3 mz-hovrose"><Trash2 size={15} strokeWidth={2} /></button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ---------- smart entry: text / voice / image -> parsed transaction ---------- */
async function parseEntry(accs, { text, image, payFrom }, ai) {
  const today = new Date().toISOString().slice(0, 10);
  const acctList = accs.map((a) => ({ id: a.id, name: a.name, unit: a.unit, class: a.assetClass, liability: !!a.isLiability }));
  const payLine = payFrom ? `The paying account is id "${payFrom}" — use it as fromId for every expense. ` : "For an unclear expense use the most likely cash account. ";
  const instructions =
    `Today is ${today}. Turn the person's quick note (and/or receipt image) into transactions for their finance app. ` +
    "The note may describe SEVERAL transactions — split them. " +
    `Their accounts as JSON: ${JSON.stringify(acctList)}. ` +
    "Reply with ONLY a JSON ARRAY (even if there is just one), no prose, no fences. Each element shape: " +
    '{"type":"expense|income|transfer","fromId":<account id or null>,"toId":<account id or null>,"fromAmount":<number>,"toAmount":<number or null>,"category":"<main category>","subcategory":"<sub>","date":"YYYY-MM-DD","note":"<short>"}. ' +
    `Prefer this category -> subcategory taxonomy, but you may add new ones if nothing fits: ${JSON.stringify(TAXONOMY)}. ` +
    "category is the main bucket; subcategory is the specific one under it (may be empty). " +
    "RECEIPTS / ORDERS: a grocery or delivery order is NOT automatically all Food — classify EVERY line item on its own merits, and NEVER file a non-food item under Food. " +
    "Non-food items and where they go: garbage/trash bags (اكياس قمامة / اكياس زبالة), tissues and wet wipes (مناديل / مناديل مبللة / محارم), foil and cling film (قصدير / ورق فويل), cleaning products and detergent (منظفات / مسحوق غسيل / كلور), dish soap, soap/shampoo/toothpaste (صابون / شامبو / معجون أسنان) → Housing/Household (toiletries may be Personal, baby items Family); batteries/bulbs → Housing/Household; medicine (دواء) → Health. Actual food and drink → Food/Groceries. " +
    "If even one non-food item is present you MUST return at least two transactions (one per category). " +
    "Output ONE expense per category, fromAmount = the summed price of that category's items, allocating any coupon/discount/service fee/tip proportionally across categories so the per-category totals add up to the amount actually charged (the order total, not the subtotal). " +
    "All lines from the same receipt share the same fromId and the same note ('<store/app>, <date>'); use the receipt's date if visible. Do not output a line that is just the grand total. " +
    "Rules: expense = money leaving (set fromId, toId null, fromAmount = amount spent). " +
    "income = money arriving (set toId, fromId null, toAmount = amount). " +
    "transfer/buy = both accounts; fromAmount is in the FROM account's unit and toAmount in the TO account's unit. " +
    payLine +
    "Use today's date unless the note or receipt says otherwise.";
  let prompt;
  if (image)
    prompt = instructions + (text ? `\n\nNote: "${text}"` : "\n\nThe image is a receipt — split its items into per-category transactions.");
  else prompt = instructions + `\n\nNote: "${text}"`;

  const out = await ai({ prompt, image: image || undefined });
  const cleaned = out.replace(/```json/g, "").replace(/```/g, "");
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  let raw;
  if (arrMatch) raw = JSON.parse(arrMatch[0]);
  else if (objMatch) raw = [JSON.parse(objMatch[0])];
  else throw new Error("no-json");
  if (!Array.isArray(raw)) raw = [raw];

  const byId = (id) => accs.find((a) => a.id === id);
  const resolve = (v) => {
    if (!v) return null;
    if (byId(v)) return v;
    const hit = accs.find((a) => a.name.toLowerCase().includes(String(v).toLowerCase()));
    return hit ? hit.id : null;
  };
  const norm = (p) => {
    const type = ["expense", "income", "transfer"].includes(p.type) ? p.type : "expense";
    return {
      type,
      fromId: type === "income" ? null : resolve(p.fromId) || accs[0]?.id,
      toId: type === "expense" ? null : resolve(p.toId) || accs[1]?.id,
      fromAmount: Number(p.fromAmount) || 0,
      toAmount: p.toAmount != null ? Number(p.toAmount) : undefined,
      category: (p.category || "").toString().slice(0, 30),
      subcategory: (p.subcategory || "").toString().slice(0, 30),
      date: /^\d{4}-\d{2}-\d{2}$/.test(p.date || "") ? p.date : today,
      note: (p.note || "").toString().slice(0, 80),
    };
  };
  const list = raw.map(norm).filter((t) => t.fromAmount || t.toAmount);
  if (!list.length) throw new Error("empty");
  return list;
}

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
}

/* offline heuristic parser — used when no AI provider is reachable */
function localParse(accs, text) {
  const t = " " + text.toLowerCase() + " ";
  const today = new Date().toISOString().slice(0, 10);
  let amount = 0;
  const m = t.match(/(\d[\d,]*\.?\d*)\s*(k|الف|ألف)?/);
  if (m) {
    amount = parseFloat(m[1].replace(/,/g, "")) || 0;
    if (m[2]) amount *= 1000;
  }
  const has = (arr) => arr.some((w) => t.includes(w));
  const incomeW = ["salary", "income", "received", "refund", "راتب", "دخل", "استلمت", "حصلت"];
  const goldW = ["gold", "دهب", "ذهب", "جرام", "عيار"];
  const transferW = ["transfer", "move", "into clouds", "to clouds", "buy", "bought", "اشتريت", "حولت", "حول", "اشترى"];
  let type = "expense";
  if (has(incomeW)) type = "income";
  else if (has(goldW) || has(transferW)) type = "transfer";

  const cash = accs.find((a) => a.assetClass === "Cash" && !a.isLiability && a.unit === "EGP") || accs[0];
  const mm = accs.find((a) => a.assetClass === "Money market") || accs[0];
  const goldAcc = accs.find((a) => a.assetClass === "Gold" && a.unit === "GOLD") || accs.find((a) => a.assetClass === "Gold");
  const findByName = () =>
    accs.find((a) => {
      const tok = a.name.toLowerCase().split(/[ (—\-]/)[0];
      return tok.length > 2 && t.includes(tok);
    });

  let fromId = null,
    toId = null,
    fromAmount = 0,
    toAmount;
  if (type === "income") {
    toId = (findByName() || mm).id;
    toAmount = amount;
  } else if (type === "transfer") {
    fromId = (findByName() || cash).id;
    fromAmount = amount;
    toId = (has(goldW) ? goldAcc : mm) ? (has(goldW) ? goldAcc : mm).id : undefined;
  } else {
    fromId = (findByName() || cash).id;
    fromAmount = amount;
  }

  let category = "",
    subcategory = "";
  if (has(["grocer", "supermarket", "بقالة", "سوبر"])) (category = "Food"), (subcategory = "Groceries");
  else if (has(["coffee", "قهوة", "كافيه"])) (category = "Food"), (subcategory = "Coffee");
  else if (has(["lunch", "dinner", "restaurant", "اكل", "مطعم", "غداء", "عشاء"])) (category = "Food"), (subcategory = "Restaurants");
  else if (has(["uber", "taxi", "تاكسي", "اوبر"])) (category = "Transport"), (subcategory = "Taxi/Uber");
  else if (has(["fuel", "petrol", "بنزين", "وقود"])) (category = "Transport"), (subcategory = "Fuel");
  else if (has(incomeW)) (category = "Income"), (subcategory = "Salary");
  else if (has(goldW)) (category = "Investment"), (subcategory = "Gold");
  else if (has(["zakat", "زكاة", "صدقة", "sadaqah"])) (category = "Giving"), (subcategory = has(["zakat", "زكاة"]) ? "Zakat" : "Sadaqah");

  return { type, fromId, toId, fromAmount, toAmount, category, subcategory, date: today, note: text.slice(0, 80) };
}

function localParseMany(accs, text) {
  const chunks = text
    .split(/\n|،|,|;|\bثم\b|\band\b|\sو\s|\+/i)
    .map((s) => s.trim())
    .filter(Boolean);
  const withNum = chunks.filter((c) => /\d/.test(c));
  const src = withNum.length ? withNum : [text];
  return src.map((c) => localParse(accs, c));
}

function QuickAdd({ accs, onParsed, focusSignal }) {
  const callAI = useContext(AICtx);
  const [text, setText] = useState("");
  const [image, setImage] = useState(null);
  const [payFrom, setPayFrom] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [listening, setListening] = useState(false);
  const recRef = useRef(null);
  const fileRef = useRef(null);
  const taRef = useRef(null);

  // the floating + button routes here: focus the box so the keyboard opens immediately
  useEffect(() => {
    if (focusSignal && taRef.current) taRef.current.focus();
  }, [focusSignal]);

  function onFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!/^image\/(jpeg|png|gif|webp)$/.test(file.type)) {
      setErr("Use a JPG, PNG, GIF or WEBP image.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const r = String(reader.result);
      const mm = /^data:(.+);base64,(.*)$/.exec(r);
      if (mm) setImage({ media: mm[1], data: mm[2], name: file.name });
    };
    reader.readAsDataURL(file);
  }

  function toggleMic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setErr("In-app voice isn't available here. Tap your keyboard's 🎤 mic and dictate straight into the box — that always works.");
      return;
    }
    if (listening) {
      recRef.current && recRef.current.stop();
      return;
    }
    const rec = new SR();
    rec.lang = navigator.language || "en-US";
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (ev) => {
      const t = ev.results[0][0].transcript;
      setText((p) => (p ? p + " " : "") + t);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recRef.current = rec;
    setErr(null);
    try {
      rec.start();
      setListening(true);
    } catch (e) {
      setListening(false);
      setErr("Couldn't start the mic here. Tap your keyboard's 🎤 mic and dictate into the box instead.");
    }
  }

  async function parse() {
    if (!text.trim() && !image) {
      setErr("Type a note, dictate one, or attach a receipt first.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const fields = await withTimeout(parseEntry(accs, { text: text.trim(), image, payFrom: payFrom || undefined }, callAI), 25000);
      onParsed(fields);
      setText("");
      setImage(null);
    } catch (e) {
      if (!image && text.trim()) {
        // Claude unreachable in this sandbox — fall back to a rough offline read
        onParsed(localParseMany(accs, text.trim()));
        setText("");
        setErr("Claude wasn't reachable here, so I did a quick offline read — check each one before saving.");
      } else {
        setErr("Reading a receipt needs Claude online, which this preview blocked. Type the details instead and I'll parse them offline.");
      }
    }
    setBusy(false);
  }

  return (
    <Card>
      <CardTitle>Quick add</CardTitle>
      <p className="text-[12px] mz-tx2 mt-1 mb-2">
        Write it however you'd say it — and list several at once: "lunch 250 cash, coffee 80, salary 95k into Clouds". Tap Parse and you review them before saving. AI parsing uses your Gemini key from Settings (or Claude inside Claude.ai); typed notes always work, offline if needed.
      </p>
      <textarea
        ref={taRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder="e.g. spent 250 on coffee, cash"
        className="w-full mz-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 resize-none"
      />
      {image && (
        <>
          <div className="flex items-center justify-between mt-2 text-[11px] font-mono border mz-note-mut rounded-lg px-2 py-1.5">
            <span className="truncate">📎 {image.name}</span>
            <button onClick={() => setImage(null)} className="mz-tx3 hover:text-rose-500 ml-2">remove</button>
          </div>
          <div className="mt-2">
            <span className="text-[11px] font-mono uppercase tracking-wide mz-tx3">Paid from</span>
            <select value={payFrom} onChange={(e) => setPayFrom(e.target.value)} className="w-full mt-1 mz-input rounded-lg px-3 py-2 text-sm">
              <option value="">auto-detect</option>
              {accs.filter((a) => !a.isLiability && a.unit !== "GOLD").map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <p className="text-[11px] mz-tx3 mt-1">A grocery receipt splits into separate transactions by category (food vs household, etc.) — all from this account, for you to review.</p>
          </div>
        </>
      )}
      {err && <div className="mt-2 text-[11px] text-rose-600 border mz-note-rose rounded-lg p-2">{err}</div>}
      <div className="flex items-center gap-2 mt-2">
        <button onClick={toggleMic} className={"text-xs font-mono px-3 py-1.5 rounded-lg border " + (listening ? "border-rose-300 text-rose-600 animate-pulse" : "mz-bd mz-tx2")}>
          {listening ? "● listening… (tap to stop)" : "🎙 dictate"}
        </button>
        <label className="relative text-xs font-mono px-3 py-1.5 rounded-lg border mz-bd mz-tx2 cursor-pointer overflow-hidden">
          📷 receipt
          <input type="file" accept="image/*" onChange={onFile} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
        </label>
        <button onClick={parse} disabled={busy} className="flex-1 text-sm font-medium px-3 py-2 rounded-lg mz-btn-primary disabled:opacity-50">
          {busy ? "reading…" : "Parse with Claude"}
        </button>
      </div>
    </Card>
  );
}

function TxnForm({ accs, onAdd, initial = {} }) {
  const today = new Date().toISOString().slice(0, 10);
  const [type, setType] = useState(initial.type || "expense");
  const [fromId, setFromId] = useState(initial.fromId || accs[0]?.id);
  const [toId, setToId] = useState(initial.toId || accs[1]?.id);
  const [fromAmount, setFromAmount] = useState(initial.fromAmount != null && initial.fromAmount !== 0 ? String(initial.fromAmount) : "");
  const [toAmount, setToAmount] = useState(initial.toAmount != null ? String(initial.toAmount) : "");
  const [category, setCategory] = useState(initial.category || "");
  const [subcategory, setSubcategory] = useState(initial.subcategory || "");
  const [note, setNote] = useState(initial.note || "");
  const [date, setDate] = useState(initial.date || today);

  const fromAcc = accs.find((a) => a.id === fromId);
  const toAcc = accs.find((a) => a.id === toId);
  const sameUnit = fromAcc && toAcc && fromAcc.unit === toAcc.unit;

  function submit() {
    const fa = Number(fromAmount) || 0;
    const ta = type === "transfer" ? (sameUnit ? fa : Number(toAmount) || 0) : type === "income" ? Number(toAmount || fromAmount) || 0 : fa;
    if (type === "income" && !ta) return;
    if (type !== "income" && !fa) return;
    onAdd({
      id: initial.id || uid(),
      date,
      type,
      fromId: type === "income" ? null : fromId,
      toId: type === "expense" ? null : toId,
      fromAmount: fa,
      toAmount: ta,
      category,
      subcategory,
      note,
    });
  }

  return (
    <div>
      <div className="flex gap-1 mz-sub rounded-lg p-1 mb-3">
        {[["expense", "Expense"], ["income", "Income"], ["transfer", "Transfer / Buy"]].map(([k, l]) => (
          <button key={k} onClick={() => setType(k)} className={"flex-1 text-xs font-medium py-1.5 rounded-md " + (type === k ? "mz-segon shadow-sm" : "mz-tx2")}>{l}</button>
        ))}
      </div>
      <div className="space-y-2">
        {type !== "income" && (
          <Field label={type === "transfer" ? "From" : "Account"}>
            <select className={inputCls} value={fromId} onChange={(e) => setFromId(e.target.value)}>
              {accs.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
        )}
        {type !== "expense" && (
          <Field label={type === "transfer" ? "To" : "Into account"}>
            <select className={inputCls} value={toId} onChange={(e) => setToId(e.target.value)}>
              {accs.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
        )}
        {type !== "income" && (
          <Field label={`Amount out (${unitLabel(fromAcc)})`}>
            <input type="number" className={inputCls + " font-mono"} value={fromAmount} onChange={(e) => setFromAmount(e.target.value)} />
          </Field>
        )}
        {((type === "transfer" && !sameUnit) || type === "income") && (
          <Field label={`Amount in (${unitLabel(toAcc)})`}>
            <input type="number" className={inputCls + " font-mono"} value={toAmount} onChange={(e) => setToAmount(e.target.value)} />
          </Field>
        )}
        <CategoryPicker category={category} subcategory={subcategory} setCategory={setCategory} setSub={setSubcategory} />
        <div className="grid grid-cols-2 gap-2">
          <Field label="Date"><input type="date" className={inputCls + " font-mono"} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Note"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" /></Field>
        </div>
        <button onClick={submit} className="w-full mz-btn-primary text-sm font-medium py-2 rounded-lg mt-1">Log it</button>
      </div>
    </div>
  );
}


/* ---------- settings page (separate view: AI key, appearance, backup, reset) ---------- */
function SettingsPage({ settings, setSettings, state, setState, prices, setPrices, history, setHistory, theme, setTheme, onBack }) {
  const toast = useContext(ToastCtx);
  const [keyDraft, setKeyDraft] = useState(settings.geminiKey || "");
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [backupText, setBackupText] = useState("");
  const [restoreText, setRestoreText] = useState("");
  const [dataMsg, setDataMsg] = useState(null);

  const inArtifact = typeof window !== "undefined" && window.storage && typeof window.storage.get === "function";
  const provider = aiProviderName(settings);

  function saveAI() {
    setSettings((s) => ({ ...s, geminiKey: keyDraft.trim() }));
    toast(keyDraft.trim() ? "Gemini key saved — AI features now use Gemini" : "Gemini key removed");
    setTestMsg(null);
  }
  async function runTest() {
    setTesting(true);
    setTestMsg(null);
    const r = await testGeminiKey(keyDraft.trim(), settings.geminiModel);
    setTestMsg(r.ok ? { ok: true, text: "Key works — " + (settings.geminiModel || DEFAULT_GEMINI_MODEL) + " responded." } : { ok: false, text: "Key check failed: " + r.error });
    setTesting(false);
  }

  function exportData() {
    const payload = JSON.stringify({ v: 1, exported: new Date().toISOString(), state, prices, history });
    setBackupText(payload);
    setDataMsg("Backup ready below — select all and copy it somewhere safe. Paste it back any time to restore.");
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(payload);
    } catch {}
  }
  async function importData() {
    try {
      const p = JSON.parse(restoreText.trim());
      const st = p.state || p;
      if (!st || !Array.isArray(st.accounts)) throw new Error("shape");
      setState(st);
      if (p.prices) setPrices(p.prices);
      if (Array.isArray(p.history)) setHistory(p.history);
      await saveKey("mizan:state", st);
      if (p.prices) await saveKey("mizan:prices", p.prices);
      if (Array.isArray(p.history)) await saveKey("mizan:history", p.history);
      setRestoreText("");
      setDataMsg("Restored " + st.accounts.length + " accounts and " + (st.transactions ? st.transactions.length : 0) + " transactions.");
    } catch (e) {
      setDataMsg("That doesn't look like a valid Mizan backup. Paste the full text you exported.");
    }
  }
  async function reset() {
    setState(SEED_STATE);
    setPrices(SEED_PRICES);
    setHistory([]);
    await saveKey("mizan:state", SEED_STATE);
    await saveKey("mizan:prices", SEED_PRICES);
    await saveKey("mizan:history", []);
    setConfirmReset(false);
  }

  return (
    <div className="max-w-3xl mx-auto px-4 pb-16 pt-6">
      <div className="flex items-center gap-1 mb-4">
        <button onClick={onBack} aria-label="Back" className="mz-iconbtn mz-tx2 -ml-2"><ArrowLeft size={18} strokeWidth={2} /></button>
        <h1 className="text-xl tracking-tight mz-tx1" style={{ fontFamily: DISPLAY_FONT, fontWeight: 700 }}>Settings</h1>
      </div>

      <div className="mz-tabview space-y-3">
        <Card>
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg" style={{ background: ACCENT + "1F", color: ACCENT }}>
                <KeyRound size={15} strokeWidth={2} />
              </span>
              <CardTitle>AI features</CardTitle>
            </span>
            <span className="text-[10px] uppercase tracking-widest font-mono" style={{ color: provider === "Gemini" ? "#0d9488" : "var(--muted)" }}>
              using {provider}
            </span>
          </div>
          <p className="text-[12px] mz-tx2 mt-2 leading-relaxed">
            Quick-add parsing, receipt reading, balance sync, and the "today (web)" price lookup are AI-powered.
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
                <button onClick={() => setShowKey((v) => !v)} className="px-3 text-[11px] font-mono mz-tx2 border mz-bd rounded-lg shrink-0">
                  {showKey ? "hide" : "show"}
                </button>
              </div>
            </Field>
            <Field label="Model">
              <select className={inputCls} value={settings.geminiModel || DEFAULT_GEMINI_MODEL} onChange={(e) => setSettings((s) => ({ ...s, geminiModel: e.target.value }))}>
                {GEMINI_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
            <div className="flex gap-2 pt-1">
              <button onClick={saveAI} className="flex-1 mz-btn-primary text-sm font-medium py-2 rounded-lg">Save</button>
              <button onClick={runTest} disabled={!keyDraft.trim() || testing} className="px-4 text-sm mz-tx2 border mz-bd rounded-lg disabled:opacity-40">
                {testing ? "testing…" : "Test key"}
              </button>
            </div>
            {testMsg && (
              <div className={"text-[11px] font-mono border rounded-lg p-2 " + (testMsg.ok ? "mz-note-teal mz-txteal" : "mz-note-rose text-rose-600")}>{testMsg.text}</div>
            )}
            <p className="text-[11px] mz-tx3">Your key is stored only in this browser and sent only to Google's API — never to any other server.</p>
          </div>
        </Card>

        <Card>
          <CardTitle>Appearance</CardTitle>
          <div className="flex gap-1 mz-sub rounded-lg p-1 mt-3">
            {[["light", "Light"], ["dark", "Dark"]].map(([k, l]) => (
              <button key={k} onClick={() => setTheme(k)} className={"flex-1 text-xs font-medium py-1.5 rounded-md " + (theme === k ? "mz-segon shadow-sm" : "mz-tx2")}>{l}</button>
            ))}
          </div>
        </Card>

      <Card>
        <CardTitle>Backup &amp; restore</CardTitle>
        <p className="text-[12px] mz-tx2 mt-1 leading-relaxed">
          Storage can reset when the app is rebuilt or reopened. Export your data as text (includes accounts, transactions, prices, and history), keep it somewhere safe, and paste it back to restore.
        </p>
        <button onClick={exportData} className="w-full mz-btn-primary text-sm font-medium py-2 rounded-lg mt-2">Export my data</button>
        {backupText && (
          <textarea readOnly value={backupText} rows={3} onFocus={(e) => e.target.select()} className="w-full mt-2 mz-input rounded-lg px-3 py-2 text-[11px] font-mono resize-none" />
        )}
        <div className="mt-3">
          <Field label="Restore from a backup">
            <textarea value={restoreText} onChange={(e) => setRestoreText(e.target.value)} rows={3} placeholder="paste your exported backup text here" className="w-full mz-input rounded-lg px-3 py-2 text-[11px] font-mono resize-none" />
          </Field>
          <button onClick={importData} disabled={!restoreText.trim()} className="w-full mz-btn-primary text-sm font-medium py-2 rounded-lg mt-2 disabled:opacity-40">Restore</button>
        </div>
        {dataMsg && <div className="mt-2 text-[11px] mz-tx2 border mz-note-mut rounded-lg p-2">{dataMsg}</div>}
      </Card>

      <Card>
        <CardTitle>Reset</CardTitle>
        <p className="text-[12px] mz-tx2 mt-1">Restores the seeded accounts from your screenshots and clears your changes. Export first if you might want them back.</p>
        {confirmReset ? (
          <div className="flex gap-2 mt-2">
            <button onClick={reset} className="flex-1 bg-rose-600 text-white text-sm font-medium py-2 rounded-lg">Yes, reset everything</button>
            <button onClick={() => setConfirmReset(false)} className="px-4 text-sm mz-tx2">Keep my data</button>
          </div>
        ) : (
          <button onClick={() => setConfirmReset(true)} className="text-sm text-rose-600 font-medium mt-2">Reset to seed</button>
        )}
      </Card>
      </div>
    </div>
  );
}

/* ---------- prices + settings ---------- */
function PricesTab({ prices, setPrices, fetching, onRefresh, onRefreshWeb, webBusy, webErr, state, setState }) {
  const toast = useContext(ToastCtx);
  const [g24, setG24] = useState(prices.gold24);
  const [fx, setFx] = useState(prices.usdEgp);

  useEffect(() => { setG24(prices.gold24); setFx(prices.usdEgp); }, [prices.gold24, prices.usdEgp]);

  function applyManual() {
    setPrices({ usdEgp: Number(fx) || prices.usdEgp, gold24: Number(g24) || prices.gold24, source: "manual", sourceName: "entered by hand", priceDate: new Date().toISOString().slice(0, 10), updated: Date.now() });
    toast("Prices updated · 24K " + fmtNum(Number(g24) || prices.gold24, 0) + " · USD " + fmtNum(Number(fx) || prices.usdEgp, 2));
  }
  function setTarget(c, v) {
    setState((s) => ({ ...s, targets: { ...s.targets, [c]: Number(v) || 0 } }));
  }
  const tgtSum = LIQUID_CLASSES.reduce((s, c) => s + (state.targets[c] || 0), 0);

  return (
    <div className="space-y-3">
      <Card>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Price feed</CardTitle>
          <div className="flex gap-1.5">
            <button onClick={onRefreshWeb} disabled={webBusy} className="text-xs font-mono px-3 py-1.5 rounded-lg mz-btn-primary disabled:opacity-50">{webBusy ? "searching…" : "fetch today (web)"}</button>
            <button onClick={onRefresh} disabled={fetching} className="text-xs font-mono px-2.5 py-1.5 rounded-lg border mz-bd mz-tx2 disabled:opacity-50">{fetching ? "…" : "api feed"}</button>
          </div>
        </div>
        <p className="text-[12px] mz-tx2 mt-2 leading-relaxed">
          <span className="font-medium mz-tx1">today (web)</span> asks your AI provider (Gemini with your key, or Claude inside Claude.ai) to search live Egyptian sources for the 24K gram price and USD/EGP. <span className="font-medium mz-tx1">api feed</span> tries a direct price API instead; faster, but the sandbox often blocks it. Either way, local صاغة prices are the 24K rate scaled by karat, so two numbers drive everything.
        </p>
        {webErr && <div className="mt-2 text-[11px] text-rose-600 border mz-note-rose rounded-lg p-2">{webErr}</div>}
        <div className="font-mono text-[11px] mz-tx3 mt-2">
          status: {prices.source} · priced {prices.priceDate || "—"}{prices.sourceName ? " · " + prices.sourceName : ""} · fetched {timeAgo(prices.updated)}
        </div>
      </Card>

      <Card>
        <CardTitle>Set prices manually</CardTitle>
        <div className="grid grid-cols-2 gap-2 mt-3">
          <Field label="24K gold — EGP/gram"><input type="number" className={inputCls + " font-mono"} value={g24} onChange={(e) => setG24(e.target.value)} /></Field>
          <Field label="USD / EGP"><input type="number" className={inputCls + " font-mono"} value={fx} onChange={(e) => setFx(e.target.value)} /></Field>
        </div>
        <button onClick={applyManual} className="w-full mz-btn-primary text-sm font-medium py-2 rounded-lg mt-2">Apply prices</button>
        <div className="grid grid-cols-4 gap-2 mt-3">
          {[24, 21, 18, 14].map((k) => (
            <div key={k} className="mz-sub rounded-lg p-2 text-center border mz-bd">
              <div className="text-[10px] font-mono mz-tx3">{k}K</div>
              <div className="font-mono tabular-nums text-sm font-semibold" style={{ color: "#F2A93B" }}>{fmtNum((Number(g24) || 0) * (k / 24), 0)}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <CardTitle>Target allocation</CardTitle>
          <span className="text-[10px] uppercase tracking-widest" style={{ fontFamily: MONO_FONT, color: "var(--muted)" }}>liquid only</span>
        </div>
        <p className="text-[12px] mz-tx2 mt-1">Targets apply to your liquid portfolio. Illiquid assets count toward net worth but aren't rebalanced.</p>
        <div className="space-y-2 mt-3">
          {LIQUID_CLASSES.map((c) => {
            const Icon = CLASS_ICON[c];
            return (
              <div key={c} className="flex items-center gap-3">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-lg shrink-0" style={{ background: CLASS_COLOR[c] + "1F", color: CLASS_COLOR[c] }}>
                  <Icon size={13} strokeWidth={2} />
                </span>
                <span className="text-sm flex-1">{c}</span>
                <input type="number" className="w-20 font-mono text-right mz-input rounded-lg px-2 py-1 text-sm" value={state.targets[c] || 0} onChange={(e) => setTarget(c, e.target.value)} />
                <span className="text-sm mz-tx3">%</span>
              </div>
            );
          })}
          <div className={"text-[11px] font-mono text-right " + (tgtSum === 100 ? "mz-tx3" : "text-amber-600")}>sums to {tgtSum}%</div>
        </div>
      </Card>

    </div>
  );
}

/* ---------- small primitives ---------- */
const inputCls = "w-full mz-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-colors";
function Card({ children }) {
  return (
    <div className="mz-card rounded-2xl p-4" style={{ boxShadow: "0 1px 2px rgba(20,35,72,0.05)" }}>
      {children}
    </div>
  );
}
function CardTitle({ children }) {
  return <div className="text-[11px] uppercase tracking-widest mz-tx2" style={{ fontFamily: MONO_FONT }}>{children}</div>;
}
function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wide mz-tx2" style={{ fontFamily: MONO_FONT }}>{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
function CategoryPicker({ category, subcategory, setCategory, setSub }) {
  const subs = TAXONOMY[category] || [];
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label="Category">
        <input className={inputCls} list="mz-maincats" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Food" />
        <datalist id="mz-maincats">{MAIN_CATS.map((c) => <option key={c} value={c} />)}</datalist>
      </Field>
      <Field label="Subcategory">
        <input className={inputCls} list="mz-subcats" value={subcategory} onChange={(e) => setSub(e.target.value)} placeholder={subs.length ? subs[0] : "optional"} />
        <datalist id="mz-subcats">{subs.map((s) => <option key={s} value={s} />)}</datalist>
      </Field>
    </div>
  );
}
