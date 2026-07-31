/* Overview tab: allocation vs. target, rebalance moves, gold spot, zakat. */

import React, { useEffect, useState } from "react";
import { Plus, Wallet, Building2, HandHeart, Info } from "lucide-react";
import { Card, CardTitle, Pill } from "./ui.jsx";
import { fmtEGP, fmtEGPShort, fmtNum, fmtPct, timeAgo } from "../lib/format.js";
import { karatPrice } from "../lib/valuation.js";
import { sourceBadge } from "../lib/prices.js";
import { zakatStatus } from "../lib/zakat.js";
import { LIQUID_CLASSES } from "../../shared/model.js";
import { ACCENT, CLASS_COLOR, CLASS_ICON, INK, MONO_FONT, DISPLAY_FONT, TEAL, AMBER } from "../theme.js";

/* ---------- allocation donut ---------- */
function AllocationDonut({ byClass, liquidTotal, active, onHover }) {
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    if (typeof requestAnimationFrame === "undefined") { setDrawn(true); return; }
    // rAF is paused in a tab that isn't compositing, which would leave the
    // donut permanently undrawn; the timer makes the draw unconditional
    const raf = requestAnimationFrame(() => setDrawn(true));
    const settle = setTimeout(() => setDrawn(true), 300);
    return () => { cancelAnimationFrame(raf); clearTimeout(settle); };
  }, []);

  const R = 40, C = 2 * Math.PI * R;
  const base = liquidTotal || 1;
  let acc = 0;
  const segs = LIQUID_CLASSES.map((c) => {
    const frac = (byClass[c] || 0) / base;
    const seg = { c, frac, offset: acc };
    acc += frac;
    return seg;
  }).filter((s) => s.frac > 0.001);

  const shown = active && byClass[active] != null ? active : null;

  return (
    <div className="relative w-[132px] h-[132px] shrink-0 mx-auto sm:mx-0">
      <svg viewBox="0 0 100 100" className="w-full h-full">
        <g transform="rotate(-90 50 50)">
          <circle cx="50" cy="50" r={R} fill="none" stroke="var(--sub2)" strokeWidth="11" />
          {segs.map((s) => (
            <circle
              key={s.c}
              cx="50" cy="50" r={R} fill="none"
              stroke={CLASS_COLOR[s.c]}
              strokeWidth={shown === s.c ? 13 : 11}
              strokeLinecap="butt"
              strokeDasharray={drawn ? `${Math.max(s.frac * C - 1.5, 0.5)} ${C}` : `0.5 ${C}`}
              strokeDashoffset={-s.offset * C}
              opacity={shown && shown !== s.c ? 0.4 : 1}
              onMouseEnter={() => onHover && onHover(s.c)}
              onMouseLeave={() => onHover && onHover(null)}
              style={{ transition: "stroke-dasharray 0.9s cubic-bezier(.22,1,.36,1), opacity .2s ease, stroke-width .2s ease", cursor: "pointer" }}
            />
          ))}
        </g>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-[9px] uppercase tracking-widest mz-tx2" style={{ fontFamily: MONO_FONT }}>{shown || "liquid"}</span>
        <span className="tabular-nums text-[13px] font-semibold mz-tx1" style={{ fontFamily: MONO_FONT }}>
          {fmtEGPShort(shown ? byClass[shown] : liquidTotal)}
        </span>
      </div>
    </div>
  );
}

/* ---------- rebalance: turn drift into concrete EGP moves ---------- */
function RebalanceCard({ byClass, targets, liquidTotal }) {
  const sum = LIQUID_CLASSES.reduce((s, c) => s + ((targets && targets[c]) || 0), 0);
  if (sum !== 100 || liquidTotal <= 0) return null; // targets incomplete — nothing sensible to say

  const moves = LIQUID_CLASSES.map((c) => ({ c, delta: (((targets[c] || 0) / 100) * liquidTotal) - (byClass[c] || 0) }));
  const maxAbs = Math.max(...moves.map((m) => Math.abs(m.delta)));

  if (maxAbs / liquidTotal < 0.02) {
    return (
      <Card>
        <div className="flex items-center justify-between">
          <CardTitle>Rebalance</CardTitle>
          <Pill color={TEAL}>on target</Pill>
        </div>
        <p className="text-[12px] mz-tx2 mt-2">Every liquid class is within 2% of its target — nothing to move.</p>
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
                <span className="font-mono tabular-nums text-sm" style={{ color: buy ? TEAL : AMBER }}>
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

/* ---------- zakat ----------
   Now with a hawl clock and the silver nisab, which is the threshold most
   guidance points to for mixed cash-and-gold wealth. */
function ZakatCard({ liquidTotal, illiquidTotal, liabilities, prices, zakat, onZakatChange, today }) {
  const [open, setOpen] = useState(false);
  const st = zakatStatus({ zakat, liquidTotal, illiquidTotal, liabilities, prices, today });

  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg shrink-0" style={{ background: TEAL + "1F", color: TEAL }}>
            <HandHeart size={15} strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-medium">Zakat</div>
            <div className="text-[11px] font-mono mz-tx3 truncate">
              nisab = {st.nisab.grams}g {st.nisab.metal} = {fmtEGPShort(st.nisab.value)}
            </div>
          </div>
        </span>
        <div className="text-right shrink-0">
          {st.above ? (
            <>
              <div className="font-mono tabular-nums text-sm" style={{ color: TEAL }}>{fmtEGP(st.due)}</div>
              <div className="text-[10px] font-mono mz-tx3">2.5% of {fmtEGPShort(st.base)}</div>
            </>
          ) : (
            <>
              <div className="font-mono tabular-nums text-sm mz-tx2">below nisab</div>
              <div className="text-[10px] font-mono mz-tx3">{fmtEGPShort(st.base)} / {fmtEGPShort(st.nisab.value)}</div>
            </>
          )}
        </div>
      </div>

      {/* hawl clock — zakat is owed on wealth held above nisab for a lunar year */}
      {st.above && st.hawlStart && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-[11px] font-mono mz-tx3 mb-1">
            <span>hawl since {st.hawlStart}</span>
            <span style={{ color: st.hawlComplete ? TEAL : "var(--faint)" }}>
              {st.hawlComplete ? "year complete — due now" : `${st.daysLeft}d to ${st.dueDate}`}
            </span>
          </div>
          <div className="h-1.5 mz-sub2 rounded-full overflow-hidden">
            <div className="mz-bar h-1.5 rounded-full" style={{ width: (st.progress * 100).toFixed(1) + "%", background: st.hawlComplete ? TEAL : ACCENT }} />
          </div>
        </div>
      )}

      {st.silverUnavailable && (
        <div className="mt-2 text-[11px] mz-tx2 border mz-note-amber rounded-lg p-2">
          No silver price available, so the gold nisab is being used instead — a higher bar. Refresh prices to pick up the silver rate.
        </div>
      )}

      <button onClick={() => setOpen((o) => !o)} className="text-[11px] font-mono mz-tx3 mz-hovi mt-2 inline-flex items-center gap-1">
        <Info size={12} strokeWidth={2} /> {open ? "hide options" : "standard & options"}
      </button>

      {open && (
        <div className="mt-2 space-y-2 border-t mz-bd pt-2">
          <div>
            <div className="text-[11px] uppercase tracking-wide mz-tx2 mb-1" style={{ fontFamily: MONO_FONT }}>Nisab standard</div>
            <div className="flex gap-1 mz-sub rounded-lg p-1">
              {[["silver", "Silver · 595g"], ["gold", "Gold · 85g"]].map(([k, l]) => (
                <button
                  key={k}
                  onClick={() => onZakatChange({ ...zakat, standard: k })}
                  className={"flex-1 text-xs font-medium py-1.5 rounded-md " + (st.standard === k ? "mz-segon shadow-sm" : "mz-tx2")}
                >
                  {l}
                </button>
              ))}
            </div>
            <p className="text-[11px] mz-tx3 mt-1">
              Silver sets a much lower threshold in today's prices, so it catches wealth sooner — the cautious choice, and the usual recommendation when holdings are mixed.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm mz-tx2">
            <input type="checkbox" checked={!!(zakat && zakat.includeIlliquid)} onChange={(e) => onZakatChange({ ...zakat, includeIlliquid: e.target.checked })} />
            Include illiquid assets in the base
          </label>
          <p className="text-[11px] mz-tx3">
            Property kept for use is normally exempt; property held to resell is not. Leave this off unless your illiquid holdings are trade goods.
          </p>
          {st.hawlStart && (
            <button onClick={() => onZakatChange({ ...zakat, hawlStart: null })} className="text-[11px] font-mono mz-tx3 mz-hovi">
              reset the hawl clock
            </button>
          )}
        </div>
      )}

      <p className="text-[11px] mz-tx3 mt-2">
        An estimate over your wealth minus liabilities, with a 354-day lunar clock. Intent, business inventory and how debts are treated all affect the real figure — treat this as a reminder, not a ruling.
      </p>
    </Card>
  );
}

/* ---------- gold spot ---------- */
export function GoldCard({ prices, fetching, onRefresh, onRefreshWeb, webBusy, webErr }) {
  const karats = [24, 21, 18, 14];
  const today = new Date().toISOString().slice(0, 10);
  const isToday = prices.priceDate === today;
  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <CardTitle>Gold spot · EGP / gram</CardTitle>
        <div className="flex gap-1.5">
          <button onClick={onRefreshWeb} disabled={webBusy} className="text-xs font-mono px-3 py-1.5 rounded-lg mz-btn-primary">
            {webBusy ? "searching…" : "today (web)"}
          </button>
          <button onClick={onRefresh} disabled={fetching} className="text-xs font-mono px-2.5 py-1.5 rounded-lg mz-btn-ghost">
            {fetching ? "…" : "refresh"}
          </button>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2 mt-3">
        {karats.map((k) => (
          <div key={k} className="mz-sub rounded-lg p-2 text-center border mz-bd">
            <div className="text-[10px] font-mono mz-tx3">{k}K</div>
            <div className="font-mono tabular-nums text-sm font-semibold" style={{ color: CLASS_COLOR.Gold }}>
              {fmtNum(karatPrice(prices, k), 0)}
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between mt-3 text-[11px] font-mono mz-tx3 gap-2">
        <span>USD/EGP {fmtNum(prices.usdEgp, 2)}{prices.silver ? ` · silver ${fmtNum(prices.silver, 1)}/g` : ""}</span>
        <span className="shrink-0">{sourceBadge(prices.source)} · {timeAgo(prices.updated)}</span>
      </div>
      <div className="mt-1 text-[11px] font-mono">
        <span style={{ color: isToday ? TEAL : AMBER }}>
          priced {isToday ? "today" : "as of " + (prices.priceDate || "—")}
          {prices.sourceName ? " · " + prices.sourceName : ""}
          {isToday ? "" : " (not today)"}
        </span>
      </div>
      {webErr && <div className="mt-2 text-[11px] mz-txrose border mz-note-rose rounded-lg p-2">{webErr}</div>}
      {prices.source === "blocked" && !webErr && (
        <div className="mt-2 text-[11px] mz-tx2 border mz-note-amber rounded-lg p-2">
          Couldn't reach a price feed. Tap "today (web)" to look it up with AI, or set it by hand under Prices — every karat rescales from the 24K number.
        </div>
      )}
    </Card>
  );
}

/* ---------- first-run welcome ---------- */
function WelcomeCard({ onNavigate }) {
  return (
    <Card>
      <div className="text-center py-4">
        <div className="mx-auto w-12 h-12 rounded-2xl flex items-center justify-center mb-3" style={{ background: ACCENT + "1A", color: ACCENT }}>
          <Wallet size={22} strokeWidth={2} />
        </div>
        <div className="text-base font-semibold mz-tx1" style={{ fontFamily: DISPLAY_FONT }}>Welcome to Mizan</div>
        <p className="text-[13px] mz-tx2 mt-1.5 max-w-sm mx-auto leading-relaxed">
          Add your accounts — cash, money market, gold by karat, funds — and Mizan values everything in EGP at live prices, tracks your allocation, and logs spending from plain-language notes.
        </p>
        <button onClick={() => onNavigate("accounts")} className="mz-btn-primary inline-flex items-center gap-1.5 text-sm font-medium px-5 py-2.5 rounded-xl mt-4">
          <Plus size={16} strokeWidth={2.4} /> Add your first account
        </button>
        <p className="text-[11px] mz-tx3 mt-3" style={{ fontFamily: MONO_FONT }}>works offline · sign in later to sync</p>
      </div>
    </Card>
  );
}

export default function Overview({
  byClass, liquidTotal, illiquidTotal, liabilities, targets, prices,
  fetching, onRefresh, onRefreshWeb, webBusy, webErr, hasAccounts, onNavigate,
  zakat, onZakatChange, today,
}) {
  const [hoverClass, setHoverClass] = useState(null);
  const total = liquidTotal || 1;

  if (!hasAccounts) {
    return (
      <div className="space-y-3">
        <WelcomeCard onNavigate={onNavigate} />
        <GoldCard prices={prices} fetching={fetching} onRefresh={onRefresh} onRefreshWeb={onRefreshWeb} webBusy={webBusy} webErr={webErr} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Card>
        <div className="flex items-center justify-between">
          <CardTitle>Allocation vs. target</CardTitle>
          <span className="text-[10px] uppercase tracking-widest" style={{ fontFamily: MONO_FONT, color: "var(--muted)" }}>liquid only</span>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 mt-3">
          <AllocationDonut byClass={byClass} liquidTotal={liquidTotal} active={hoverClass} onHover={setHoverClass} />
          <div className="space-y-3 flex-1 min-w-0">
            {LIQUID_CLASSES.map((c) => {
              const actual = ((byClass[c] || 0) / total) * 100;
              const tgt = (targets && targets[c]) || 0;
              const drift = actual - tgt;
              const Icon = CLASS_ICON[c];
              return (
                <div key={c} onMouseEnter={() => setHoverClass(c)} onMouseLeave={() => setHoverClass(null)}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="inline-flex items-center gap-2">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-lg shrink-0" style={{ background: CLASS_COLOR[c] + "1F", color: CLASS_COLOR[c] }}>
                        <Icon size={13} strokeWidth={2} />
                      </span>
                      <span className="font-medium">{c}</span>
                    </span>
                    <span className="font-mono tabular-nums mz-tx2">{fmtEGP(byClass[c] || 0)}</span>
                  </div>
                  <div className="relative h-2 mz-sub2 rounded-full overflow-visible">
                    <div className="mz-bar absolute h-2 rounded-full" style={{ width: Math.min(actual, 100) + "%", background: CLASS_COLOR[c] }} />
                    <div className="absolute top-[-3px] h-3 w-0.5 rounded" style={{ left: Math.min(tgt, 100) + "%", background: INK }} title={`target ${tgt}%`} />
                  </div>
                  <div className="flex justify-between text-[11px] font-mono mt-0.5 mz-tx3">
                    <span>{actual.toFixed(1)}% actual</span>
                    <span style={Math.abs(drift) < 3 ? undefined : { color: drift > 0 ? AMBER : TEAL }}>
                      target {tgt}% · {fmtPct(drift)} drift
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
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

      {liquidTotal > 0 && (
        <ZakatCard
          liquidTotal={liquidTotal}
          illiquidTotal={illiquidTotal}
          liabilities={liabilities}
          prices={prices}
          zakat={zakat}
          onZakatChange={onZakatChange}
          today={today}
        />
      )}
    </div>
  );
}
