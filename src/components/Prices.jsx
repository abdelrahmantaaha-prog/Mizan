/* Prices tab: the feed, manual overrides, target allocation, and gold history. */

import React, { useEffect, useMemo, useState } from "react";
import { Card, CardTitle, Field, NumberInput, useToast } from "./ui.jsx";
import { fmtNum, fmtPct, timeAgo, dayLabel } from "../lib/format.js";
import { sourceBadge } from "../lib/prices.js";
import { LIQUID_CLASSES, touchScalar } from "../../shared/model.js";
import { CLASS_COLOR, MONO_FONT } from "../theme.js";

/* A price series is the only way to tell whether gold moved or your holding
   did — the account card shows P&L, but not what drove it. */
function PriceHistory({ series }) {
  const data = useMemo(() => (series || []).slice(-90), [series]);
  if (data.length < 2) {
    return (
      <Card>
        <CardTitle>Gold price history</CardTitle>
        <p className="text-[12px] mz-tx2 mt-2">
          Builds up as prices refresh — one close per day. Come back after a few days of use.
        </p>
      </Card>
    );
  }
  const vals = data.map((d) => d.gold24);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const W = 600, H = 56, PAD = 4;
  const pts = vals.map((v, i) => `${((i / (vals.length - 1)) * W).toFixed(1)},${(H - PAD - ((v - min) / span) * (H - PAD * 2)).toFixed(1)}`);
  const chg = vals[0] ? ((vals[vals.length - 1] - vals[0]) / vals[0]) * 100 : 0;
  const color = chg >= 0 ? CLASS_COLOR.Gold : "var(--flow-out)";

  return (
    <Card>
      <div className="flex items-center justify-between">
        <CardTitle>Gold price history · 24K</CardTitle>
        <span className="text-[11px] font-mono tabular-nums" style={{ color }}>{fmtPct(chg)} over {data.length}d</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-14 mt-3" role="img" aria-label="24 karat gold price history">
        <defs>
          <linearGradient id="mzgoldfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`M ${pts[0]} L ${pts.slice(1).join(" L ")} L ${W},${H} L 0,${H} Z`} fill="url(#mzgoldfill)" />
        <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-[10px] font-mono mz-tx3 mt-1">
        <span>{dayLabel(data[0].d)} · {fmtNum(vals[0], 0)}</span>
        <span>{dayLabel(data[data.length - 1].d)} · {fmtNum(vals[vals.length - 1], 0)}</span>
      </div>
    </Card>
  );
}

export default function PricesTab({ prices, setPrices, fetching, onRefresh, onRefreshWeb, webBusy, webErr, state, setState }) {
  const toast = useToast();
  const [g24, setG24] = useState(prices.gold24);
  const [fx, setFx] = useState(prices.usdEgp);
  const [silver, setSilver] = useState(prices.silver ?? "");

  useEffect(() => {
    setG24(prices.gold24);
    setFx(prices.usdEgp);
    setSilver(prices.silver ?? "");
  }, [prices.gold24, prices.usdEgp, prices.silver]);

  function applyManual() {
    const nextGold = Number(g24) || prices.gold24;
    const nextFx = Number(fx) || prices.usdEgp;
    setPrices({
      usdEgp: nextFx,
      gold24: nextGold,
      silver: silver === "" ? prices.silver : Number(silver) || undefined,
      source: "manual",
      sourceName: "entered by hand",
      priceDate: new Date().toISOString().slice(0, 10),
      updated: Date.now(),
    });
    toast("Prices updated · 24K " + fmtNum(nextGold, 0) + " · USD " + fmtNum(nextFx, 2));
  }

  const targets = state.targets || {};
  const setTarget = (c, v) =>
    setState((s) => touchScalar(s, "targets", { ...(s.targets || {}), [c]: Number(v) || 0 }));
  const tgtSum = LIQUID_CLASSES.reduce((s, c) => s + (targets[c] || 0), 0);

  return (
    <div className="space-y-3">
      <Card>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Price feed</CardTitle>
          <div className="flex gap-1.5">
            <button onClick={onRefreshWeb} disabled={webBusy} className="text-xs font-mono px-3 py-1.5 rounded-lg mz-btn-primary">
              {webBusy ? "searching…" : "fetch today (web)"}
            </button>
            <button onClick={onRefresh} disabled={fetching} className="text-xs font-mono px-2.5 py-1.5 rounded-lg mz-btn-ghost">
              {fetching ? "…" : "refresh"}
            </button>
          </div>
        </div>
        <p className="text-[12px] mz-tx2 mt-2 leading-relaxed">
          <span className="font-medium mz-tx1">refresh</span> pulls spot gold, silver and USD/EGP — through this deployment's own endpoint when it's available, so nothing is blocked by browser CORS.{" "}
          <span className="font-medium mz-tx1">today (web)</span> asks your AI provider to search Egyptian sources instead, which is the only route that reads the local صاغة price rather than deriving it from global spot. Either way, every karat rescales from the 24K number.
        </p>
        {webErr && <div className="mt-2 text-[11px] mz-txrose border mz-note-rose rounded-lg p-2">{webErr}</div>}
        <div className="font-mono text-[11px] mz-tx3 mt-2">
          {sourceBadge(prices.source)} · priced {prices.priceDate || "—"}{prices.sourceName ? " · " + prices.sourceName : ""} · fetched {timeAgo(prices.updated)}
        </div>
      </Card>

      <Card>
        <CardTitle>Set prices manually</CardTitle>
        <div className="grid grid-cols-2 gap-2 mt-3">
          <Field label="24K gold — EGP/gram"><NumberInput value={g24} onChange={setG24} /></Field>
          <Field label="USD / EGP"><NumberInput value={fx} onChange={setFx} /></Field>
        </div>
        <Field label="Silver — EGP/gram (optional)" hint="only used for the silver zakat nisab">
          <NumberInput value={silver} onChange={setSilver} placeholder="leave blank to keep the fetched value" />
        </Field>
        <button onClick={applyManual} className="w-full mz-btn-primary text-sm font-medium py-2 rounded-lg mt-2">Apply prices</button>
        <div className="flex justify-between mt-4">
          {[24, 21, 18, 14].map((k) => (
            <div key={k}>
              <div className="text-[10px] uppercase mz-tx3" style={{ fontFamily: MONO_FONT, fontWeight: 600, letterSpacing: "0.16em" }}>{k}K</div>
              <div className="tabular-nums text-lg mt-1" style={{ fontWeight: 200, letterSpacing: "-0.02em" }}>
                {fmtNum((Number(g24) || 0) * (k / 24), 0)}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <PriceHistory series={state.priceHistory} />

      <Card>
        <div className="flex items-center justify-between">
          <CardTitle>Target allocation</CardTitle>
          <span className="text-[11px] font-light mz-tx3">liquid only</span>
        </div>
        <p className="text-[12px] mz-tx2 mt-1">Targets apply to your liquid portfolio. Illiquid assets count toward net worth but aren't rebalanced.</p>
        <div className="space-y-2 mt-3">
          {LIQUID_CLASSES.map((c) => {
            return (
              <div key={c} className="flex items-center gap-3">
                <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: CLASS_COLOR[c] }} />
                <span className="text-sm flex-1">{c}</span>
                <NumberInput
                  className="w-20 font-mono text-right mz-input rounded-lg px-2 py-1 text-sm"
                  value={targets[c] || 0}
                  onChange={(v) => setTarget(c, v)}
                  allowEmpty={false}
                />
                <span className="text-sm mz-tx3">%</span>
              </div>
            );
          })}
          <div className="text-[11px] font-mono text-right" style={{ color: tgtSum === 100 ? "var(--muted)" : "var(--flow-warn)" }}>
            sums to {tgtSum}%{tgtSum === 100 ? "" : " — rebalance advice needs exactly 100%"}
          </div>
        </div>
      </Card>
    </div>
  );
}
