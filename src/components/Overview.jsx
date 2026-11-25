/* Overview tab: allocation vs. target, rebalance moves, gold spot, zakat. */

import React, { useState } from "react";
import { Plus, Wallet, Building2, HandHeart, Info } from "lucide-react";
import { Card, CardTitle, Pill } from "./ui.jsx";
import { fmtEGP, fmtEGPShort, fmtNum, fmtPct, timeAgo } from "../lib/format.js";
import { karatPrice } from "../lib/valuation.js";
import { sourceBadge } from "../lib/prices.js";
import { zakatStatus } from "../lib/zakat.js";
import { LIQUID_CLASSES } from "../../shared/model.js";
import { CLASS_COLOR, MONO_FONT, DISPLAY_FONT, TEAL } from "../theme.js";

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
      <div className="mt-3 divide-y mz-dv">
        {moves
          .filter((m) => Math.abs(m.delta) >= liquidTotal * 0.005)
          .sort((a, b) => b.delta - a.delta)
          .map(({ c, delta }) => {
            const buy = delta > 0;
            return (
              <div key={c} className="flex items-center gap-3 py-2.5">
                <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: CLASS_COLOR[c] }} />
                <span className="text-sm flex-1 min-w-0 truncate">{c}</span>
                <span className="tabular-nums text-sm" style={{ color: buy ? "var(--flow-in)" : "var(--flow-warn)" }}>
                  {buy ? "add " : "trim "}{fmtEGP(Math.abs(delta))}
                </span>
              </div>
            );
          })}
      </div>
      <p className="text-[11px] font-light mz-tx3 mt-2.5">amounts that bring each class to its target share of your liquid portfolio</p>
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
      {/* The hawl is a year going round, so it is drawn as one. The bar it
          replaces read as progress toward a goal; this reads as a clock, which
          is what it is — and it puts the whole status in one glance: how far
          round, and what is owed when it closes. */}
      <div className="flex items-center gap-4">
        <span className="relative shrink-0" style={{ width: 52, height: 52 }}>
          <svg width="52" height="52" viewBox="0 0 52 52" aria-hidden="true">
            <circle cx="26" cy="26" r="22" fill="none" stroke="var(--sub2)" strokeWidth="3" />
            {st.above && st.hawlStart && (
              <circle
                cx="26" cy="26" r="22" fill="none"
                stroke={st.hawlComplete ? "var(--flow-in)" : "var(--ink)"}
                strokeWidth="3" strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 22}
                strokeDashoffset={(1 - Math.min(1, st.progress)) * 2 * Math.PI * 22}
                transform="rotate(-90 26 26)"
                style={{ transition: "stroke-dashoffset 0.8s cubic-bezier(.22,1,.36,1)" }}
              />
            )}
          </svg>
          <HandHeart
            size={16}
            strokeWidth={1.8}
            className="absolute inset-0 m-auto mz-tx3"
            style={{ width: 16, height: 16 }}
          />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm">
            Zakat{st.above ? "" : " · below nisab"}
          </div>
          <div className="text-[11px] font-light mz-tx3 mt-0.5">
            {st.above && st.hawlStart
              ? st.hawlComplete
                ? "the year is complete — due now"
                : `${st.daysLeft} days of the hawl left · due ${st.dueDate}`
              : `nisab ${st.nisab.grams}g ${st.nisab.metal} = ${fmtEGPShort(st.nisab.value)}`}
          </div>
        </div>
        <div className="text-right shrink-0">
          {st.above ? (
            <>
              <div className="tabular-nums text-sm">{fmtEGP(st.due)}</div>
              <div className="text-[11px] font-light mz-tx3">2.5% of {fmtEGPShort(st.base)}</div>
            </>
          ) : (
            <div className="text-[11px] font-light mz-tx3 tabular-nums">
              {fmtEGPShort(st.base)} / {fmtEGPShort(st.nisab.value)}
            </div>
          )}
        </div>
      </div>

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
      {/* four figures on one line, no tiles: they are the same quantity at
          four purities, and boxing each one implies they are four things */}
      <div className="flex justify-between mt-4">
        {karats.map((k) => (
          <div key={k}>
            <div className="text-[10px] uppercase mz-tx3" style={{ fontFamily: MONO_FONT, fontWeight: 600, letterSpacing: "0.16em" }}>{k}K</div>
            <div className="tabular-nums text-lg mt-1" style={{ fontWeight: 200, letterSpacing: "-0.02em" }}>
              {fmtNum(karatPrice(prices, k), 0)}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3.5 text-[11px] font-light mz-tx3">
        EGP/gram · USD/EGP {fmtNum(prices.usdEgp, 2)}{prices.silver ? ` · silver ${fmtNum(prices.silver, 1)}/g` : ""}
      </div>
      <div className="mt-1 text-[11px] font-light">
        <span style={isToday ? { color: "var(--muted)" } : { color: "var(--flow-warn)" }}>
          priced {isToday ? "today" : "as of " + (prices.priceDate || "—")}
          {prices.sourceName ? " · " + prices.sourceName : ""}
          {isToday ? "" : " — not today"}
        </span>
        <span className="mz-tx3"> · {sourceBadge(prices.source)} · {timeAgo(prices.updated)}</span>
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
        <div className="mx-auto w-12 h-12 rounded-2xl flex items-center justify-center mb-3" style={{ background: "var(--sub2)", color: "var(--ink)" }}>
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
      {/* Allocation.

          The donut and the five per-class progress bars are gone. The ribbon
          in the hero already says what the mix is; repeating it as a pie and
          then again as bars was the same fact three times. What is left is the
          part a ribbon cannot show — how far each class has drifted from where
          you wanted it — and Tide's rule applies: the only thing coloured is
          the only thing that is off. */}
      <Card>
        <div className="flex items-center justify-between">
          <CardTitle>Allocation</CardTitle>
          <span className="text-[11px] font-light mz-tx3">liquid only</span>
        </div>
        <div className="mt-3 divide-y mz-dv">
          {LIQUID_CLASSES.map((c) => {
            const actual = ((byClass[c] || 0) / total) * 100;
            const tgt = (targets && targets[c]) || 0;
            const drift = actual - tgt;
            const off = Math.abs(drift) >= 3 && tgt > 0;
            return (
              <div key={c} className="flex items-center gap-3 py-2.5">
                <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: CLASS_COLOR[c] }} />
                <span className="flex-1 min-w-0">
                  <span className="text-sm block truncate">{c}</span>
                  <span className="text-[11px] font-light mz-tx3">
                    {tgt > 0 ? `target ${tgt}%` : "no target set"}
                    {off ? ` · ${fmtPct(drift)}` : ""}
                  </span>
                </span>
                <span className="text-right shrink-0">
                  {/* Sand in both directions. Being under a target is not
                      good news any more than being over it is — they are both
                      just "not where you said", and colouring one mint would
                      claim a judgement the app has no business making. */}
                  <span className="tabular-nums text-sm block" style={off ? { color: "var(--flow-warn)" } : undefined}>
                    {actual.toFixed(0)}%
                  </span>
                  <span className="tabular-nums text-[11px] font-light mz-tx3">{fmtEGPShort(byClass[c] || 0)}</span>
                </span>
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
