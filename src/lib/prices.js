/* Gold and FX price sourcing.

   Three routes, in order of how much they cost the user:

   1. /api/prices — our own Vercel function. It fetches server-side, so the
      browser's CORS rules and the sandboxes that used to leave the app stuck
      on "blocked" never come into it, and the response is cached for everyone.
   2. the public APIs directly from the browser — works on the open web, kept
      as the fallback for anyone running the app without the backend.
   3. the AI provider with search grounding — last resort, costs tokens, and is
      the only route that can read the Egyptian صاغة market rather than
      derive a local price from the global spot. */

import { OZ_TO_GRAM } from "./valuation.js";
import { isNative } from "./native.js";

export const SEED_PRICES = {
  usdEgp: 49.9,
  gold24: 6500,
  source: "seed",
  sourceName: "fallback baseline",
  priceDate: "2026-06-26",
  updated: Date.now(),
};

const today = () => new Date().toISOString().slice(0, 10);

/* plausibility gates — a bad parse should never silently reprice a portfolio */
export const inGoldRange = (n) => n > 2000 && n < 20000;
export const inFxRange = (n) => n > 20 && n < 150;

/* ---------- route 1: our serverless proxy ---------- */
async function fetchProxyPrices() {
  const res = await fetch("/api/prices", { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("proxy-" + res.status);
  const j = await res.json();
  if (!inGoldRange(Number(j.gold24)) || !inFxRange(Number(j.usdEgp))) throw new Error("proxy-range");
  return {
    usdEgp: Number(j.usdEgp),
    gold24: Number(j.gold24),
    source: "live",
    sourceName: j.sourceName || "spot XAU × USD/EGP",
    priceDate: j.priceDate || today(),
    updated: Date.now(),
  };
}

/* ---------- route 2: public APIs, straight from the browser ---------- */
async function fetchDirectPrices(prev) {
  let usdEgp = prev.usdEgp;
  let gotFx = false, gotGold = false, spotUsd = null;
  try {
    const fx = await fetch("https://open.er-api.com/v6/latest/USD");
    const j = await fx.json();
    if (j && j.rates && j.rates.EGP) { usdEgp = j.rates.EGP; gotFx = true; }
  } catch {}
  try {
    const g = await fetch("https://api.gold-api.com/price/XAU");
    const j = await g.json();
    if (j && j.price) { spotUsd = j.price; gotGold = true; }
  } catch {}
  let gold24 = prev.gold24;
  if (gotGold && usdEgp) gold24 = (spotUsd / OZ_TO_GRAM) * usdEgp;
  const ok = gotFx && gotGold;
  return {
    usdEgp,
    gold24,
    source: ok ? "live" : gotFx || gotGold ? "partial" : "blocked",
    sourceName: ok ? "spot XAU × USD/EGP" : prev.sourceName,
    priceDate: ok ? today() : prev.priceDate,
    updated: Date.now(),
  };
}

/* Proxy first, direct as the fallback. Returns source:"blocked" only when
   neither route produced anything usable. */
export async function fetchLivePrices(prev) {
  // The Android app has no server of its own behind /api, and its WebView
  // is not held back by the browser sandboxes the proxy exists for.
  if (isNative()) return fetchDirectPrices(prev);
  try {
    return await fetchProxyPrices();
  } catch {
    return fetchDirectPrices(prev);
  }
}

/* ---------- route 3: AI with search grounding ---------- */
export async function fetchWebPrices(ai) {
  const t = today();
  const prompt =
    `Today's date is ${t}. I need the current Egyptian local-market gold price and USD/EGP rate. ` +
    `If you have a web/search tool available, USE IT — search Arabic sources like "سعر جرام الذهب عيار 24 مصر اليوم" ` +
    "and report the most recently dated price you find, with the date the source published it. " +
    "If you cannot search, give your best known recent values and set as_of_date honestly to the date your knowledge is from — do not claim today's date for remembered values. " +
    "Reply with ONLY a JSON object, no prose, no markdown fences. Exact shape: " +
    '{"gold24_egp_per_gram": <number>, "usd_egp": <number>, "as_of_date": "YYYY-MM-DD", "source": "<short site name, or \'model knowledge\'>"}. ' +
    "gold24_egp_per_gram = price of one gram of 24-karat gold in the Egyptian local market (الصاغة), in EGP. " +
    "usd_egp = Egyptian pounds per one US dollar.";
  const text = await ai({ prompt, search: true });
  const match = text.replace(/```json/g, "").replace(/```/g, "").match(/\{[\s\S]*\}/);
  if (!match) throw new Error("no-json");
  const parsed = JSON.parse(match[0]);
  const gold24 = Number(parsed.gold24_egp_per_gram);
  const usdEgp = Number(parsed.usd_egp);
  if (!inGoldRange(gold24)) throw new Error("gold-range");
  if (!inFxRange(usdEgp)) throw new Error("fx-range");
  let priceDate = /^\d{4}-\d{2}-\d{2}$/.test(parsed.as_of_date || "") ? parsed.as_of_date : t;
  if (priceDate > t) priceDate = t; // never trust a future-dated claim
  const stale = (Date.now() - new Date(priceDate).getTime()) / 86400000 > 2;
  return {
    gold24,
    usdEgp,
    priceDate,
    sourceName: (parsed.source || "web search").toString().slice(0, 40),
    stale,
  };
}

/* One close per calendar day. Later reads on the same day overwrite, so the
   series reflects the freshest price we saw rather than the first. */
export function recordPriceDay(series, prices) {
  const d = prices.priceDate || today();
  const entry = { d, gold24: Math.round(prices.gold24), usdEgp: Number((prices.usdEgp || 0).toFixed(3)), updatedAt: Date.now() };
  const rest = (series || []).filter((x) => x.d !== d);
  return [...rest, entry].sort((a, b) => (a.d < b.d ? -1 : 1)).slice(-400);
}

export const sourceBadge = (source) =>
  source === "web" ? "● web"
  : source === "live" ? "● live"
  : source === "manual" ? "✎ manual"
  : source === "partial" ? "◐ partial"
  : source === "blocked" ? "○ offline"
  : "○ seed";
