/* The hero: net worth, its trend, and the liquid allocation ribbon. */

import React, { useMemo, useRef, useState } from "react";
import { CountUp } from "./ui.jsx";
import { fmtEGP, fmtEGPShort, fmtNum, fmtPct, dayLabel } from "../lib/format.js";
import { LIQUID_CLASSES } from "../../shared/model.js";
import { INK, INK_2, HAIRLINE, ACCENT, MUTED_ON_DARK, CLASS_COLOR, LIABILITY_COLOR } from "../theme.js";

const RANGES = [
  ["30", "30d", 30],
  ["90", "90d", 90],
  ["365", "1y", 365],
  ["all", "all", Infinity],
];

/* small dark-card stat — compact figures so three columns never clip */
function HeroStat({ label, value, exact, color }) {
  return (
    <div className="min-w-0" title={exact || undefined}>
      <div className="text-[10px] uppercase tracking-widest" style={{ fontFamily: "var(--mz-mono)", color: MUTED_ON_DARK }}>{label}</div>
      <div className="tabular-nums text-sm mt-0.5 truncate" style={{ fontFamily: "var(--mz-mono)", color: color || "#EAF1FF" }}>{value}</div>
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
      <div className="mt-3 text-[10px] uppercase tracking-widest" style={{ fontFamily: "var(--mz-mono)", color: MUTED_ON_DARK }}>
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
  const lineColor = up ? "#34D399" : LIABILITY_COLOR;

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
              className="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded"
              style={{
                fontFamily: "var(--mz-mono)",
                color: range === k ? "#EAF1FF" : MUTED_ON_DARK,
                background: range === k ? "rgba(234,241,255,0.12)" : "transparent",
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-[10px] tabular-nums" style={{ fontFamily: "var(--mz-mono)", color: lineColor }}>
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
            <line x1={xOf(active)} y1="0" x2={xOf(active)} y2={H} stroke="rgba(234,241,255,0.35)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          )}
          <circle
            cx={xOf(active ?? nets.length - 1)}
            cy={yOf(nets[active ?? nets.length - 1])}
            r="3.5"
            fill={lineColor}
            stroke={INK}
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>

      <div className="flex items-center justify-between mt-1 text-[10px] tabular-nums" style={{ fontFamily: "var(--mz-mono)", color: MUTED_ON_DARK }}>
        <span>{dayLabel(shown.d)}</span>
        <span style={{ color: "#EAF1FF" }}>{fmtEGP(shown.net)}</span>
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

  const fmtMain =
    denom === "USD" ? (v) => "$" + Math.round(v / usdEgp).toLocaleString("en-US")
    : denom === "GOLD" ? (v) => fmtNum(v / gold24, 0) + " g"
    : (v) => fmtEGP(v);

  const sub =
    denom === "USD" ? fmtEGP(net) + " @ " + fmtNum(usdEgp, 2)
    : denom === "GOLD" ? fmtEGP(net) + " · 24K @ " + fmtNum(gold24, 0) + "/g"
    : "≈ $" + Math.round(net / usdEgp).toLocaleString("en-US") + " · ≈ " + fmtNum(net / gold24, 0) + " g gold";

  return (
    <div className="relative rounded-2xl p-5 mb-3 overflow-hidden" style={{ background: INK, border: `1px solid ${HAIRLINE}` }}>
      {/* ambient glow, drifting slowly */}
      <div className="pointer-events-none absolute -top-16 -right-10 w-56 h-56 rounded-full mz-float"
           style={{ background: `radial-gradient(closest-side, ${ACCENT}33, transparent)` }} />

      <div className="relative">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] uppercase tracking-widest" style={{ fontFamily: "var(--mz-mono)", color: MUTED_ON_DARK }}>Net worth</span>
          <button onClick={cycle} className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full"
                  style={{ fontFamily: "var(--mz-mono)", color: ACCENT, background: ACCENT + "1A", border: `1px solid ${ACCENT}40` }}>
            {denom === "GOLD" ? "grams" : denom} · tap
          </button>
        </div>
        <button onClick={cycle} className="block text-left w-full" aria-label={"Net worth in " + denom + ", tap to switch denomination"}>
          <CountUp
            value={net}
            format={fmtMain}
            className="tabular-nums text-[2.6rem] leading-none tracking-tight truncate block"
            style={{ fontFamily: "var(--mz-display)", fontWeight: 600, color: "#EAF1FF" }}
          />
          <div className="tabular-nums text-sm mt-1.5" style={{ fontFamily: "var(--mz-mono)", color: MUTED_ON_DARK }}>{sub}</div>
        </button>

        <TrendChart history={history} />

        {/* liquid / illiquid / liabilities split */}
        <div className="grid grid-cols-3 gap-3 mt-4 pt-4" style={{ borderTop: `1px solid ${HAIRLINE}` }}>
          <HeroStat label="Liquid" value={fmtEGPShort(liquidTotal)} exact={fmtEGP(liquidTotal)} color={CLASS_COLOR["Money market"]} />
          <HeroStat label="Illiquid" value={hasIlliquid ? fmtEGPShort(illiquidTotal) : "—"} exact={hasIlliquid ? fmtEGP(illiquidTotal) : undefined} color={hasIlliquid ? CLASS_COLOR.Illiquid : "#7A89A8"} />
          <HeroStat label="Liabilities" value={liabilities ? fmtEGPShort(liabilities) : "—"} exact={liabilities ? fmtEGP(liabilities) : undefined} color={liabilities ? LIABILITY_COLOR : "#7A89A8"} />
        </div>
      </div>

      {/* liquid allocation ribbon with target ticks */}
      <div className="relative mt-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] uppercase tracking-widest" style={{ fontFamily: "var(--mz-mono)", color: MUTED_ON_DARK }}>Liquid allocation</span>
          <span className="text-[10px]" style={{ fontFamily: "var(--mz-mono)", color: "#7A89A8" }}>ticks = targets</span>
        </div>
        <div className="relative h-2.5 w-full rounded-full overflow-hidden flex" style={{ background: INK_2 }}>
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
              return <div key={"t" + c} className="absolute top-0 h-2.5" style={{ left: acc + "%", width: "2px", background: "rgba(234,241,255,0.55)" }} />;
            });
          })()}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5">
          {LIQUID_CLASSES.map((c) => (
            <span key={c} className="inline-flex items-center gap-1.5 text-[11px]" style={{ fontFamily: "var(--mz-mono)", color: MUTED_ON_DARK }}>
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: CLASS_COLOR[c] }} />
              {c} {(((byClass[c] || 0) / base) * 100).toFixed(0)}%
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
