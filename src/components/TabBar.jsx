import React from "react";
import { MONO_FONT } from "../theme.js";

const ITEMS = [
  ["overview", "Home"],
  ["accounts", "Accounts"],
  ["activity", "Log"],
  ["spending", "Spend"],
  ["prices", "Prices"],
];

/* Bottom nav, Tide version: five small labels, the active one at full
   strength with a dot under it. No icons, no pill, no accent — a nav that
   announces itself is a nav competing with the number above it.

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
      <div className="max-w-3xl mx-auto px-4 pt-3 pb-2 flex items-center justify-between" style={{ paddingBottom: "max(10px, env(safe-area-inset-bottom))" }}>
        {ITEMS.map(([k, label]) => {
          const active = tab === k;
          return (
            <button
              key={k}
              data-active={active}
              onClick={() => setTab(k)}
              aria-label={label}
              aria-current={active ? "page" : undefined}
              tabIndex={active ? 0 : -1}
              className="mz-tabbtn relative px-3 py-2 text-[10px] uppercase"
              style={{
                fontFamily: MONO_FONT,
                fontWeight: 600,
                letterSpacing: "0.16em",
                color: active ? "var(--ink)" : "var(--faint)",
                opacity: active ? 1 : 0.75,
              }}
            >
              {label}
              {active && (
                <span
                  className="mz-tablabel absolute left-1/2 -translate-x-1/2 rounded-full"
                  style={{ bottom: "1px", width: "3px", height: "3px", background: "currentColor" }}
                />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
