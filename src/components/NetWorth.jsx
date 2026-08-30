/* The hero: net worth, its trend, and the liquid allocation ribbon.

   In Tide the hero is not a card. There is one ground for the whole app and
   this sits directly on it — no panel, no border, nothing to detach the most
   important number in the app from the field it lives on.

   The trend line carries the month's flow. That is the load-bearing decision
   of the whole direction: the original pitch had the *ground* drift with your
   net flow, which works beautifully in the dark and is very nearly invisible
   on the pale one. Rather than ship an idea that only half exists, the drift
   moved to the one element that is already about change over time. The field
   stays constant, the line goes mint or clay, and light mode means it. */

import React, { useMemo, useRef, useState } from "react";
import { CountUp } from "./ui.jsx";
import { fmtEGP, fmtEGPShort, fmtNum, fmtPct, dayLabel } from "../lib/format.js";
import { LIQUID_CLASSES } from "../../shared/model.js";
import { CLASS_COLOR, LIABILITY_COLOR } from "../theme.js";

const RANGES = [
  ["30", "30d", 30],
  ["90", "90d", 90],
  ["365", "1y", 365],
  ["all", "all", Infinity],
];

/* compact figures so three columns never clip */
function HeroStat({ label, value, exact, color }) {
  return (
    <div className="min-w-0" title={exact || undefined}>
      <div className="text-[10px] uppercase mz-tx3" style={{ fontFamily: "var(--mz-mono)", fontWeight: 600, letterSpacing: "0.18em" }}>{label}</div>
      <div className="tabular-nums text-sm mt-1 truncate" style={{ fontFamily: "var(--mz-mono)", fontWeight: 400, color: color || "var(--ink)" }}>{value}</div>
    </div>
  );
}

/* Net-worth trend.

   The old version was a fixed 90-day line you could not interrogate: no dates,
   no values, no way to see a different window. This one lets you pick the
   range and drag along the line to read any day — which is the only way a
   sparkline in a finance app earns its space. */
function TrendChart({ history }) {
  const [range, setRange] = useState("90");
  const [hover, setHover] = useState(null);
  const svgRef = useRef(null);

  const data = useMemo(() => {
    const days = RANGES.find((r) => r[0] === range)?.[2] ?? 90;
    const src = history || [];
    return days === Infinity ? src : src.slice(-days);
  }, [history, range]);

  if (!history || history.length < 2) {
    return (
      <div className="mt-4 text-[12px] font-light mz-tx3">
        History builds as you use the app — one snapshot a day.
      </div>
    );
  }
  if (data.length < 2) return null;

  const nets = data.map((x) => x.net);
  const min = Math.min(...nets);
  const max = Math.max(...nets);
  const span = max - min || Math.abs(max) || 1;
  const W = 600, H = 64, PAD = 4;

  const xOf = (i) => (i / (nets.length - 1)) * W;
  const yOf = (v) => H - PAD - ((v - min) / span) * (H - PAD * 2);
  const pts = nets.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`);

  const first = nets[0];
  const last = nets[nets.length - 1];
  const chg = first ? ((last - first) / Math.abs(first)) * 100 : 0;
  const up = chg >= 0;
  /* the flow signal, and the only colour on this screen */
  const lineColor = up ? "var(--flow-in)" : "var(--flow-out)";

  const active = hover != null ? Math.max(0, Math.min(nets.length - 1, hover)) : null;

  const onMove = (e) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    setHover(Math.round((x / rect.width) * (nets.length - 1)));
  };

  const shown = active != null ? data[active] : data[data.length - 1];

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-1 gap-2">
        <div className="flex gap-1">
          {RANGES.map(([k, label]) => (
            <button
              key={k}
              onClick={() => { setRange(k); setHover(null); }}
              className="text-[10px] uppercase px-2.5 py-1 rounded-full"
              style={{
                fontFamily: "var(--mz-mono)",
                fontWeight: 600,
                letterSpacing: "0.14em",
                color: range === k ? "var(--btn-fg)" : "var(--faint)",
                background: range === k ? "var(--btn-bg)" : "transparent",
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-[11px] tabular-nums font-medium" style={{ color: lineColor }}>
          {fmtPct(chg)} since {dayLabel(data[0].d)}
        </span>
      </div>

      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="w-full h-16 mz-scrub"
          role="img"
          aria-label={`Net worth trend, ${fmtPct(chg)} over the selected range`}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          onTouchStart={onMove}
          onTouchMove={onMove}
          onTouchEnd={() => setHover(null)}
        >
          <defs>
            <linearGradient id="mzsparkfill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={lineColor} stopOpacity="0.32" />
              <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`M ${pts[0]} L ${pts.slice(1).join(" L ")} L ${W},${H} L 0,${H} Z`} fill="url(#mzsparkfill)" />
          <polyline points={pts.join(" ")} fill="none" stroke={lineColor} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {active != null && (
            <line x1={xOf(active)} y1="0" x2={xOf(active)} y2={H} stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          )}
          <circle
            cx={xOf(active ?? nets.length - 1)}
            cy={yOf(nets[active ?? nets.length - 1])}
            r="3.5"
            fill={lineColor}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>

      <div className="flex items-center justify-between mt-1.5 text-[11px] tabular-nums font-light mz-tx3">
        <span>{dayLabel(shown.d)}</span>
        <span className="mz-tx1">{fmtEGP(shown.net)}</span>
      </div>
    </div>
  );
}

export default function NetWorthBlock({ net, liabilities, byClass, targets, prices, liquidTotal, illiquidTotal, history }) {
  const [denom, setDenom] = useState("EGP"); // EGP -> USD -> GOLD -> EGP
  const usdEgp = prices.usdEgp || 1;
  const gold24 = prices.gold24 || 1;
  const base = liquidTotal || 1; // ribbon + targets are computed over LIQUID only
  const hasIlliquid = illiquidTotal > 0;

  const cycle = () => setDenom((d) => (d === "EGP" ? "USD" : d === "USD" ? "GOLD" : "EGP"));

  /* The figure carries no unit. At 200 weight and 46px it is the one thing on
     the screen, and "EGP" in front of it is three letters of noise competing
     with six digits of meaning — the unit belongs in the line underneath,
     where the conversions already are. */
  const fmtMain =
    denom === "USD" ? (v) => Math.round(v / usdEgp).toLocaleString("en-US")
    : denom === "GOLD" ? (v) => fmtNum(v / gold24, 0)
    : (v) => Math.round(v).toLocaleString("en-US");

  const sub =
    denom === "USD" ? "USD · " + fmtEGP(net) + " at " + fmtNum(usdEgp, 2)
    : denom === "GOLD" ? "grams of 24K · " + fmtEGP(net) + " at " + fmtNum(gold24, 0) + "/g"
    : "EGP · ≈ $" + Math.round(net / usdEgp).toLocaleString("en-US") + " · ≈ " + fmtNum(net / gold24, 0) + " g gold";

  return (
    <div className="relative px-1 pt-3 pb-5 mb-1">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase mz-tx3" style={{ fontFamily: "var(--mz-mono)", fontWeight: 600, letterSpacing: "0.2em" }}>Net worth</span>
        <button onClick={cycle} className="text-[10px] uppercase px-3 py-1 rounded-full mz-btn-ghost"
                style={{ fontFamily: "var(--mz-mono)", fontWeight: 600, letterSpacing: "0.14em" }}>
          {denom === "GOLD" ? "grams" : denom} · tap
        </button>
      </div>
      <button onClick={cycle} className="block text-left w-full" aria-label={"Net worth in " + denom + ", tap to switch denomination"}>
        <CountUp
          value={net}
          format={fmtMain}
          className="tabular-nums text-[2.9rem] leading-none truncate block mz-tx1"
          style={{ fontFamily: "var(--mz-display)", fontWeight: 200, letterSpacing: "-0.03em" }}
        />
        <div className="tabular-nums text-[13px] mt-2.5 font-light mz-tx2">{sub}</div>
      </button>

      <TrendChart history={history} />

      {/* liquid / illiquid / liabilities split */}
      <div className="grid grid-cols-3 gap-3 mt-5 pt-4" style={{ borderTop: "1px solid var(--line)" }}>
        <HeroStat label="Liquid" value={fmtEGPShort(liquidTotal)} exact={fmtEGP(liquidTotal)} />
        <HeroStat label="Illiquid" value={hasIlliquid ? fmtEGPShort(illiquidTotal) : "—"} exact={hasIlliquid ? fmtEGP(illiquidTotal) : undefined} />
        <HeroStat
          label="Liabilities"
          value={liabilities ? "−" + fmtEGPShort(liabilities) : "—"}
          exact={liabilities ? fmtEGP(liabilities) : undefined}
          color={liabilities ? LIABILITY_COLOR : undefined}
        />
      </div>

      {/* liquid allocation ribbon with target ticks */}
      <div className="relative mt-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] uppercase mz-tx3" style={{ fontFamily: "var(--mz-mono)", fontWeight: 600, letterSpacing: "0.2em" }}>Liquid allocation</span>
          <span className="text-[11px] font-light mz-tx3">ticks = targets</span>
        </div>
        <div className="relative h-1.5 w-full rounded-full overflow-hidden flex" style={{ background: "var(--sub2)" }}>
          {LIQUID_CLASSES.map((c) => {
            const pct = ((byClass[c] || 0) / base) * 100;
            if (pct <= 0) return null;
            return <div key={c} className="mz-bar h-full" style={{ width: pct + "%", background: CLASS_COLOR[c] }} title={`${c} ${pct.toFixed(1)}%`} />;
          })}
          {(() => {
            let acc = 0;
            return LIQUID_CLASSES.map((c) => {
              acc += (targets && targets[c]) || 0;
              if (acc >= 100) return null;
              return <div key={"t" + c} className="absolute top-0 h-1.5" style={{ left: acc + "%", width: "2px", background: "var(--bg-solid)", opacity: 0.85 }} />;
            });
          })()}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
          {LIQUID_CLASSES.map((c) => (
            <span key={c} className="inline-flex items-center gap-1.5 text-[11px] font-light mz-tx2">
              <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: CLASS_COLOR[c] }} />
              {c} {(((byClass[c] || 0) / base) * 100).toFixed(0)}%
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
