/* Spending tab: budgets, monthly totals, cashflow, category breakdown.

   Every EGP figure here comes from the rate captured when the transaction was
   logged (see lib/valuation.js). Before that, a refreshed gold or FX price
   quietly rewrote past months — "March" was a different number depending on
   when you looked at it. */

import React, { useMemo, useState } from "react";
import { Card, CardTitle, EmptyNote, NumberInput } from "./ui.jsx";
import { fmtEGP, fmtEGPShort, monthLabel } from "../lib/format.js";
import { outEgp, inEgp } from "../lib/valuation.js";
import { MAIN_CATS, live, touchScalar } from "../../shared/model.js";
import { catColor, MONO_FONT } from "../theme.js";

function Budgets({ state, setState, prices }) {
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState({});
  const budgets = state.budgets || {};
  const ym = new Date().toISOString().slice(0, 7);
  const accs = useMemo(() => live(state, "accounts"), [state]);

  const spent = useMemo(() => {
    const m = {};
    live(state, "transactions")
      .filter((t) => t.type === "expense" && (t.date || "").slice(0, 7) === ym)
      .forEach((t) => {
        const c = t.category || "Uncategorized";
        m[c] = (m[c] || 0) + outEgp(t, accs, prices);
      });
    return m;
  }, [state, accs, prices, ym]);

  const cats = useMemo(
    () =>
      Array.from(new Set([...Object.keys(budgets), ...Object.keys(spent)]))
        .filter((c) => budgets[c] || spent[c])
        .sort((a, b) => (budgets[b] ? spent[b] / budgets[b] : 0) - (budgets[a] ? spent[a] / budgets[a] : 0)),
    [budgets, spent]
  );

  function openEdit() {
    const d = {};
    Object.keys(budgets).forEach((c) => (d[c] = budgets[c]));
    setDraft(d);
    setEdit(true);
  }
  function save() {
    const nb = {};
    Object.keys(draft).forEach((c) => {
      const v = Number(draft[c]);
      if (v > 0) nb[c] = v;
    });
    setState((s) => touchScalar(s, "budgets", nb));
    setEdit(false);
  }


  return (
    <Card>
      <div className="flex items-center justify-between">
        <CardTitle>Monthly budgets · {monthLabel(ym)}</CardTitle>
        <button onClick={() => (edit ? setEdit(false) : openEdit())} className="text-xs font-mono px-3 py-1.5 rounded-lg mz-btn-ghost">
          {edit ? "cancel" : "set budgets"}
        </button>
      </div>

      {edit ? (
        <div className="mt-3 space-y-2">
          <p className="text-[11px] mz-tx3 font-mono">Monthly cap per category (EGP). Leave blank for no limit.</p>
          {MAIN_CATS.filter((c) => c !== "Income").map((c) => (
            <div key={c} className="flex items-center gap-3">
              <span className="inline-flex items-center justify-center w-2 h-2 rounded-full shrink-0" style={{ background: catColor(c) }} />
              <span className="text-sm flex-1">{c}</span>
              <NumberInput
                placeholder="—"
                className="w-28 font-mono text-right mz-input rounded-lg px-2 py-1 text-sm"
                value={draft[c] ?? ""}
                onChange={(v) => setDraft((d) => ({ ...d, [c]: v }))}
              />
            </div>
          ))}
          <button onClick={save} className="w-full mz-btn-primary text-sm font-medium py-2 rounded-lg mt-1">Save budgets</button>
        </div>
      ) : cats.length === 0 ? (
        <p className="text-[12px] mz-tx2 mt-2">
          No budgets yet. Tap “set budgets” to cap spending per category — you'll get a warning as you near each cap, and when you log an expense that crosses it.
        </p>
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
            /* One place colour survives on this screen: a budget in trouble.
               A meter tracking comfortably is drawn in ink like everything
               else, so the one that is clay is impossible to miss. */
            const over = r > 1;
            const near = r >= 0.8;
            const fill = over ? "var(--flow-out)" : near ? "var(--flow-warn)" : "var(--ink)";
            return (
              <div key={c}>
                <div className="flex items-center justify-between text-sm mb-1.5">
                  <span>{c}</span>
                  <span className="tabular-nums" style={near ? { color: fill } : { color: "var(--muted)" }}>
                    {fmtEGP(sp)} <span className="mz-tx3">/ {fmtEGP(b)}</span>
                  </span>
                </div>
                <div className="h-1 rounded-full overflow-hidden" style={{ background: "var(--sub2)" }}>
                  <div className="h-1 rounded-full transition-all" style={{ width: Math.min(r * 100, 100) + "%", background: fill }} />
                </div>
                {near && (
                  <div className="text-[11px] font-light mt-1.5" style={{ color: fill }}>
                    {over ? `over by ${fmtEGP(sp - b)}` : `${Math.round(r * 100)}% used · ${fmtEGP(b - sp)} left`}
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

export default function Spending({ state, setState, prices }) {
  const [month, setMonth] = useState(null);
  const [cat, setCat] = useState(null);

  const accs = useMemo(() => live(state, "accounts"), [state]);
  const txns = useMemo(() => live(state, "transactions"), [state]);

  /* One pass over the ledger, memoised. This used to run twice per render on
     every state change — including while typing in an unrelated field. */
  const { expenses, incomes } = useMemo(() => {
    const ex = [];
    const inc = [];
    txns.forEach((t) => {
      const ym = (t.date || "").slice(0, 7);
      if (!ym) return;
      if (t.type === "expense") ex.push({ ...t, egp: outEgp(t, accs, prices), ym });
      else if (t.type === "income") inc.push({ egp: inEgp(t, accs, prices), ym });
    });
    return { expenses: ex, incomes: inc };
  }, [txns, accs, prices]);

  const monthTotals = useMemo(() => {
    const m = new Map();
    expenses.forEach((e) => m.set(e.ym, (m.get(e.ym) || 0) + e.egp));
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([mm, total]) => ({ m: mm, total }));
  }, [expenses]);

  if (expenses.length === 0) {
    return (
      <div className="space-y-3">
        <Budgets state={state} setState={setState} prices={prices} />
        <Card>
          <CardTitle>Spending</CardTitle>
          <EmptyNote>No expenses logged yet. Once you record some under Activity, they'll break down here by category and by month.</EmptyNote>
        </Card>
      </div>
    );
  }

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

  const cfMonths = Array.from(new Set([...expenses.map((e) => e.ym), ...incomes.map((i) => i.ym)])).sort().slice(-6).reverse();

  return (
    <div className="space-y-3">
      <Budgets state={state} setState={setState} prices={prices} />

      <Card>
        <div className="flex items-baseline justify-between">
          <CardTitle>By month</CardTitle>
          <span className="font-mono tabular-nums text-sm">{fmtEGP(scopeTotal)}{month ? "" : " total"}</span>
        </div>
        {/* No axis, no gridlines, no value on every bar: the selected month is
            simply the solid one, and its figure is already in the header. */}
        <div className="flex items-end gap-2 h-32 mt-4">
          {monthTotals.map(({ m, total }) => {
            const sel = month === m;
            return (
              <button
                key={m}
                onClick={() => setMonth(sel ? null : m)}
                className="flex-1 flex flex-col items-center justify-end h-full group"
                aria-pressed={sel}
                title={`${monthLabel(m)} · ${fmtEGP(total)}`}
              >
                <div
                  className="w-full transition-all"
                  style={{
                    height: Math.max((total / maxMonth) * 100, 3) + "%",
                    borderRadius: "6px 6px 2px 2px",
                    background: sel ? "var(--ink)" : "var(--sub2)",
                  }}
                />
                <span
                  className="text-[10px] uppercase mt-2"
                  style={{ fontFamily: MONO_FONT, fontWeight: 600, letterSpacing: "0.12em", color: sel ? "var(--ink)" : "var(--faint)" }}
                >
                  {monthLabel(m)}
                </span>
              </button>
            );
          })}
        </div>
        <div className="text-[11px] font-light mz-tx3 mt-3">
          {month ? "showing " + monthLabel(month) + " · tap again for all months" : "tap a bar to drill into one month"}
        </div>
      </Card>

      {cfMonths.length > 0 && (
        <Card>
          <CardTitle>Cashflow · income vs. spend</CardTitle>
          <div className="divide-y mz-dv mt-1">
            {cfMonths.map((m) => {
              const inc = incomes.filter((i) => i.ym === m).reduce((s, i) => s + i.egp, 0);
              const out = expenses.filter((e) => e.ym === m).reduce((s, e) => s + e.egp, 0);
              const netM = inc - out;
              return (
                <div key={m} className="flex items-center justify-between py-2 text-sm gap-2">
                  <span className="font-mono mz-tx2 w-16 shrink-0">{monthLabel(m)}</span>
                  <span className="font-mono tabular-nums text-[12px]" style={{ color: "var(--flow-in)" }}>+{fmtEGPShort(inc).replace("EGP ", "")}</span>
                  <span className="font-mono tabular-nums text-[12px]" style={{ color: "var(--flow-out)" }}>−{fmtEGPShort(out).replace("EGP ", "")}</span>
                  <span className="font-mono tabular-nums font-semibold" style={{ color: netM >= 0 ? "var(--flow-in)" : "var(--flow-out)" }}>
                    {netM >= 0 ? "+" : "−"}{fmtEGPShort(Math.abs(netM)).replace("EGP ", "")}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="text-[10px] font-mono mz-tx3 mt-2 text-right">in · out · net (EGP)</div>
        </Card>
      )}

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
        {/* A plain column, ordered by size. The icon chips and the coloured
            bar per row were seven colours saying the same thing the order
            already says; what survives is the dot, which is the only part that
            ties a row back to the ribbon. The share is a hairline under the
            row rather than a bar beside it. */}
        <div className="mt-3 divide-y mz-dv">
          {rows.map(([c, v]) => {
            const clickable = !drill; // tap a main category to open its subcategories
            const Tag = clickable ? "button" : "div";
            const color = drill ? catColor(cat) : catColor(c);
            return (
              <Tag key={c} onClick={clickable ? () => setCat(c) : undefined} className="block w-full text-left py-2.5">
                <div className="flex items-center gap-3">
                  <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
                  <span className="text-sm flex-1 min-w-0 truncate">
                    {c}
                    {clickable && <span className="ml-1 mz-tx3">›</span>}
                  </span>
                  <span className="tabular-nums text-sm shrink-0">{fmtEGP(v)}</span>
                  <span className="tabular-nums text-[11px] font-light mz-tx3 w-9 text-right shrink-0">
                    {((v / rowsTotal) * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="h-[2px] mt-2 rounded-full overflow-hidden" style={{ background: "var(--sub)" }}>
                  <div className="mz-bar h-[2px] rounded-full" style={{ width: Math.max((v / maxRow) * 100, 2) + "%", background: color, opacity: 0.85 }} />
                </div>
              </Tag>
            );
          })}
        </div>
        {!drill && <div className="text-[11px] font-light mz-tx3 mt-3">tap a category to see its subcategories</div>}
      </Card>
    </div>
  );
}
