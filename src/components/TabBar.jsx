import React from "react";
import { PieChart, Wallet, ArrowRightLeft, BarChart3, Coins } from "lucide-react";
import { ACCENT, MONO_FONT } from "../theme.js";

const ITEMS = [
  ["overview", "Overview", PieChart],
  ["accounts", "Accounts", Wallet],
  ["activity", "Activity", ArrowRightLeft],
  ["spending", "Spending", BarChart3],
  ["prices", "Prices", Coins],
];

/* Bottom tab bar: icons only, the active tab expanding into a labelled pill.
   Arrow keys move between tabs so the bar is usable without a pointer. */
export default function TabBar({ tab, setTab }) {
  function onKeyDown(e) {
    const i = ITEMS.findIndex(([k]) => k === tab);
    if (e.key === "ArrowRight") { e.preventDefault(); setTab(ITEMS[(i + 1) % ITEMS.length][0]); }
    if (e.key === "ArrowLeft") { e.preventDefault(); setTab(ITEMS[(i - 1 + ITEMS.length) % ITEMS.length][0]); }
  }
  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-30 mz-bottombar"
      style={{ backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)", boxShadow: "0 -6px 24px rgba(20,35,72,0.06)" }}
      aria-label="Sections"
      onKeyDown={onKeyDown}
    >
      <div className="max-w-3xl mx-auto px-3 py-1.5 flex items-center justify-between" style={{ paddingBottom: "max(6px, env(safe-area-inset-bottom))" }}>
        {ITEMS.map(([k, label, Icon]) => {
          const active = tab === k;
          return (
            <button
              key={k}
              data-active={active}
              onClick={() => setTab(k)}
              aria-label={label}
              aria-current={active ? "page" : undefined}
              tabIndex={active ? 0 : -1}
              className="mz-tabbtn flex items-center gap-1.5 rounded-full px-3 py-1.5"
              style={active ? { background: ACCENT + "14", color: ACCENT } : { color: "var(--muted)" }}
            >
              <Icon size={18} strokeWidth={active ? 2.3 : 1.9} className="mz-tabicon" />
              {active && <span className="mz-tablabel text-[11px] font-semibold" style={{ fontFamily: MONO_FONT }}>{label}</span>}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
