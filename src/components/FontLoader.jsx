/* Fonts and the global stylesheet.

   Theme tokens are defined on :root (the <html> element, which App tags with
   data-theme) rather than on a wrapper, so portaled content — modals render
   into <body>, outside the app root — still resolves every variable. */

import React, { useEffect } from "react";

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
    // one family, five weights: 200 carries every figure, 600 the small caps
    link.href = "https://fonts.googleapis.com/css2?family=Manrope:wght@200;300;400;500;600&display=swap";
    document.head.appendChild(link);
  }, []);

  return (
    <style>{`
      /* ---- theme tokens ----
         Tide has one ground and no cards. --bg is therefore a gradient rather
         than a colour, and --card is a translucent well that lets the field
         show through instead of an opaque panel sitting on top of it.

         --muted and --faint carry the small labels the app leans on heavily,
         so both are set against the *lightest* end of their own field rather
         than against a flat colour — a token that only clears 4.5:1 at the top
         of the gradient fails halfway down the page. */
      :root {
        --bg: linear-gradient(168deg, #F4F8F8 0%, #E9F1F2 55%, #DDEBEB 100%);
        --bg-solid: #EEF4F4;
        --card: rgba(12,31,51,0.055); --line: rgba(12,31,51,0.11);
        --ink: #0C1F33; --muted: #46596B; --faint: #566A7C;
        --sub: rgba(12,31,51,0.05); --sub2: rgba(12,31,51,0.10);
        --btn-bg: #0C1F33; --btn-fg: #F2F6F7;
        --flow-in: #0E7C68; --flow-out: #B9543A; --flow-warn: #96671A;
        --well-hi: rgba(12,31,51,0.09);
        /* font stacks as variables so components can reference them from
           inline styles without importing the theme module */
        --mz-display: 'Manrope', ui-sans-serif, system-ui, sans-serif;
        --mz-body: 'Manrope', ui-sans-serif, system-ui, sans-serif;
        --mz-mono: 'Manrope', ui-sans-serif, system-ui, sans-serif;
        /* Tailwind resolves font-sans/font-mono through these, so every
           className="font-mono" in the app follows the type system too */
        --font-sans: 'Manrope', ui-sans-serif, system-ui, sans-serif;
        --font-mono: 'Manrope', ui-sans-serif, system-ui, sans-serif;
      }
      :root[data-theme="dark"] {
        --bg: linear-gradient(168deg, #0C1F33 0%, #123B4A 56%, #17565A 100%);
        --bg-solid: #0C1F33;
        --card: rgba(255,255,255,0.07); --line: rgba(234,244,244,0.13);
        --ink: #EAF4F4; --muted: #B9CFD1; --faint: #9BB4B7;
        --sub: rgba(255,255,255,0.06); --sub2: rgba(255,255,255,0.12);
        --btn-bg: #EAF4F4; --btn-fg: #0C1F33;
        --flow-in: #7FE0C4; --flow-out: #F2A18C; --flow-warn: #F5C77E;
        --well-hi: rgba(255,255,255,0.11);
      }
      html { background: var(--bg-solid); }
      /* the field is painted once, over the whole scroll height — it is the
         only surface in the design, so nothing may tile or repeat it */
      .mz-root {
        background: var(--bg); background-attachment: scroll; color: var(--ink);
        font-weight: 300; letter-spacing: 0.002em;
      }
      /* figures are the one thing that carries weight downward, not upward */
      .tabular-nums, .mz-fig { font-variant-numeric: tabular-nums; }

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
      /* Notes are wells with a tint, not bordered alert boxes: the border is
         the thing Tide removes everywhere else, so it cannot come back here. */
      .mz-note-rose  { background: color-mix(in srgb, var(--flow-out) 14%, transparent);  border-color: transparent; }
      .mz-note-amber { background: color-mix(in srgb, var(--flow-warn) 14%, transparent); border-color: transparent; }
      .mz-note-teal  { background: color-mix(in srgb, var(--flow-in) 14%, transparent);   border-color: transparent; }
      .mz-note-blue  { background: var(--well-hi); border-color: transparent; }
      .mz-note-mut   { background: var(--sub); border-color: transparent; }
      .mz-txblue { color: var(--ink); }
      .mz-txteal { color: var(--flow-in); }
      .mz-txamber { color: var(--flow-warn); }
      .mz-txamber2 { color: var(--ink); }
      .mz-txrose { color: var(--flow-out); }

      /* ---- keyboard focus ----
         Only inputs used to show focus, so anyone navigating by keyboard lost
         the cursor the moment they tabbed onto a button or a tab. */
      :focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; border-radius: 999px; }
      .mz-root button:focus:not(:focus-visible) { outline: none; }

      /* Every control is a pill. The filled one is the ink itself — one per
         screen, the thing to do here; everything else is an outline. */
      .mz-btn-primary {
        background: var(--btn-bg); color: var(--btn-fg); border-radius: 999px;
        font-weight: 500; letter-spacing: 0.005em;
        transition: opacity 0.15s ease, transform 0.12s ease;
      }
      .mz-btn-primary:hover:not(:disabled) { opacity: 0.88; }
      .mz-btn-primary:active:not(:disabled) { transform: translateY(1px); }
      .mz-btn-primary:disabled { opacity: 0.45; cursor: not-allowed; }
      .mz-btn-ghost {
        border: 1px solid var(--line); border-radius: 999px; color: var(--muted);
        font-weight: 500; transition: border-color .15s ease, color .15s ease;
      }
      .mz-btn-ghost:hover:not(:disabled) { border-color: var(--muted); color: var(--ink); }

      /* padded icon buttons: ≥40px hit area */
      .mz-iconbtn { padding: 0.55rem; border-radius: 0.6rem; line-height: 0; transition: background 0.15s ease, color 0.15s ease, transform 0.1s ease; }
      .mz-iconbtn:hover { background: var(--sub); }
      .mz-iconbtn:active { transform: scale(0.9); }
      .mz-hovrose:hover { color: var(--flow-out); }
      .mz-hovblue:hover { color: var(--ink); }

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

      /* A well, not a card: no border, no shadow, no lift. It is a slightly
         lighter patch of the same field, and it must never look detached. */
      .mz-card { background: var(--card); border: 0; transition: background 0.2s ease; }
      .mz-card:hover { background: var(--well-hi); }

      .mz-bar { transition: width 0.6s cubic-bezier(.22,1,.36,1); transform-origin: left; animation: mzGrowX 0.7s cubic-bezier(.22,1,.36,1) both; }

      /* sticky date headers in the activity list */
      .mz-daybar { position: sticky; top: 0; z-index: 1; background: var(--bg-solid); }

      /* bottom nav: a hairline over the field, not a bar sitting on it */
      .mz-bottombar { background: color-mix(in srgb, var(--bg-solid) 78%, transparent); border-top: 1px solid var(--line); }
      .mz-tabbtn { transition: color 0.2s ease, background 0.2s ease, transform 0.15s ease; }
      .mz-tabbtn:active { transform: scale(0.92); }
      .mz-tabicon { transition: transform 0.25s cubic-bezier(.34,1.56,.64,1); }
      .mz-tabbtn[data-active="true"] .mz-tabicon { transform: scale(1.05); }
      .mz-tablabel { animation: mzFade 0.25s ease both; }

      /* floating quick-add — the solid pill, in its most literal form */
      .mz-fab { width: 52px; height: 52px; border-radius: 9999px; background: var(--btn-bg); color: var(--btn-fg); display: flex; align-items: center; justify-content: center; transition: transform 0.15s ease, opacity 0.2s ease; }
      .mz-fab:hover { opacity: 0.88; }
      .mz-fab:active { transform: scale(0.9); }

      /* toasts */
      .mz-toast { animation: mzRise 0.28s cubic-bezier(.22,1,.36,1) both; }

      /* modal overlay — a sheet rising out of the field it belongs to */
      .mz-backdrop { background: rgba(5,17,28,0.62); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); animation: mzFade 0.2s ease both; }
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
