/* Fonts and the global stylesheet.

   Theme tokens are defined on :root (the <html> element, which App tags with
   data-theme) rather than on a wrapper, so portaled content — modals render
   into <body>, outside the app root — still resolves every variable. */

import React, { useEffect } from "react";
import { ACCENT, ACCENT_DIM } from "../theme.js";

export default function FontLoader() {
  useEffect(() => {
    if (document.getElementById("mizan-fonts")) return;
    // preconnect first: the stylesheet and the font files are on different
    // hosts, and the handshake to gstatic is otherwise serialised behind the CSS
    const pre = (href, cors) => {
      const l = document.createElement("link");
      l.rel = "preconnect";
      l.href = href;
      if (cors) l.crossOrigin = "anonymous";
      document.head.appendChild(l);
    };
    pre("https://fonts.googleapis.com");
    pre("https://fonts.gstatic.com", true);

    const link = document.createElement("link");
    link.id = "mizan-fonts";
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap";
    document.head.appendChild(link);
  }, []);

  return (
    <style>{`
      /* ---- theme tokens ----
         --muted and --faint are the small mono labels the app leans on heavily.
         They used to sit around 3:1 against the card, which fails WCAG AA at
         the 10–11px they are rendered at; both are darkened in light mode and
         lightened in dark mode to clear 4.5:1. */
      :root {
        --bg: #EEF3FB; --card: #FFFFFF; --line: #DCE4F1;
        --ink: #1B2740; --muted: #5B6A82; --faint: #647184;
        --sub: #F1F5FA; --sub2: #E3EAF4;
        /* font stacks as variables so components can reference them from
           inline styles without importing the theme module */
        --mz-display: 'Space Grotesk', ui-sans-serif, system-ui, sans-serif;
        --mz-body: 'Inter', ui-sans-serif, system-ui, sans-serif;
        --mz-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', monospace;
      }
      :root[data-theme="dark"] {
        --bg: #0B1424; --card: #121F38; --line: #243756;
        --ink: #E7EEFB; --muted: #A3B2CE; --faint: #8394B4;
        --sub: #1A2A4A; --sub2: #24365E;
      }
      .mz-root { background: var(--bg); color: var(--ink); }

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
      .mz-txblue { color: #2563EB; } :root[data-theme="dark"] .mz-txblue { color: #7EA6FF; }
      .mz-txteal { color: #0F766E; } :root[data-theme="dark"] .mz-txteal { color: #2DD4BF; }
      .mz-txamber { color: #B45309; } :root[data-theme="dark"] .mz-txamber { color: #FBBF24; }
      .mz-txamber2 { color: #78350F; } :root[data-theme="dark"] .mz-txamber2 { color: #FDE68A; }
      .mz-txrose { color: #E11D48; } :root[data-theme="dark"] .mz-txrose { color: #FB7185; }

      /* ---- keyboard focus ----
         Only inputs used to show focus, so anyone navigating by keyboard lost
         the cursor the moment they tabbed onto a button or a tab. */
      :focus-visible { outline: 2px solid ${ACCENT}; outline-offset: 2px; border-radius: 0.4rem; }
      .mz-root button:focus:not(:focus-visible) { outline: none; }

      .mz-btn-primary { background: ${ACCENT}; color: #FFFFFF; transition: background 0.15s ease, transform 0.12s ease, box-shadow 0.15s ease; box-shadow: 0 1px 2px rgba(12,23,48,0.10); }
      .mz-btn-primary:hover:not(:disabled) { background: ${ACCENT_DIM}; box-shadow: 0 4px 14px rgba(59,125,255,0.28); }
      .mz-btn-primary:active:not(:disabled) { transform: translateY(1px); }
      .mz-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
      .mz-btn-ghost { border: 1px solid var(--line); color: var(--muted); transition: border-color .15s ease, color .15s ease; }
      .mz-btn-ghost:hover:not(:disabled) { border-color: var(--muted); color: var(--ink); }

      /* padded icon buttons: ≥40px hit area */
      .mz-iconbtn { padding: 0.55rem; border-radius: 0.6rem; line-height: 0; transition: background 0.15s ease, color 0.15s ease, transform 0.1s ease; }
      .mz-iconbtn:hover { background: var(--sub); }
      .mz-iconbtn:active { transform: scale(0.9); }
      .mz-hovrose:hover { color: #E11D48; }
      .mz-hovblue:hover { color: ${ACCENT}; }

      @keyframes mzRise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
      @keyframes mzFade { from { opacity: 0; } to { opacity: 1; } }
      @keyframes mzShimmer { from { background-position: -200% 0; } to { background-position: 200% 0; } }
      @keyframes mzFloat { 0%, 100% { transform: translate(0, 0); } 50% { transform: translate(-10px, 8px); } }
      @keyframes mzGrowX { from { transform: scaleX(0); } to { transform: scaleX(1); } }
      @keyframes mzSpin { to { transform: rotate(360deg); } }
      @keyframes mzPulse { 0%,100% { opacity: 1; } 50% { opacity: .45; } }
      .mz-float { animation: mzFloat 9s ease-in-out infinite; }
      .mz-spin { animation: mzSpin 1s linear infinite; }
      .mz-pulse { animation: mzPulse 1.6s ease-in-out infinite; }

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

      .mz-bar { transition: width 0.6s cubic-bezier(.22,1,.36,1); transform-origin: left; animation: mzGrowX 0.7s cubic-bezier(.22,1,.36,1) both; }

      /* sticky date headers in the activity list */
      .mz-daybar { position: sticky; top: 0; z-index: 1; background: color-mix(in srgb, var(--card) 92%, transparent); backdrop-filter: blur(6px); }

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

      /* chart scrubber */
      .mz-scrub { cursor: crosshair; touch-action: none; }

      @media (prefers-reduced-motion: reduce) {
        .mz-tabview > *, .mz-tablabel, .mz-tabicon, .mz-bar, .mz-card, .mz-toast, .mz-skel, .mz-fab, .mz-iconbtn, .mz-modal, .mz-backdrop, .mz-float, .mz-spin, .mz-pulse { animation: none !important; transition: none !important; }
      }
    `}</style>
  );
}
