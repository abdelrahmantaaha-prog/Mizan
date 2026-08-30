/* Shared primitives: cards, fields, the modal, toasts, and the inputs. */

import React, { createContext, useContext, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { ACCENT, MONO_FONT } from "../theme.js";

export const ToastCtx = createContext(() => {});
export const AICtx = createContext(async () => { throw new Error("ai-unavailable"); });
export const useToast = () => useContext(ToastCtx);
export const useAI = () => useContext(AICtx);

export const inputCls =
  "w-full mz-input rounded-xl px-3.5 py-2.5 text-sm font-light focus:outline-none transition-colors";

/* A well. Not a card — no border, no shadow, nothing detached from the field
   behind it; just a slightly lighter patch of the same ground. */
export function Card({ children, className = "", ...rest }) {
  return (
    <div className={"mz-card rounded-[20px] p-4 " + className} {...rest}>
      {children}
    </div>
  );
}

/* The 10px label at 0.2em is the only place weight goes up in this system. */
export function CardTitle({ children }) {
  return (
    <div className="text-[10px] uppercase mz-tx2" style={{ fontFamily: MONO_FONT, fontWeight: 600, letterSpacing: "0.2em" }}>
      {children}
    </div>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase mz-tx2" style={{ fontFamily: MONO_FONT, fontWeight: 600, letterSpacing: "0.18em" }}>{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && <span className="text-[11px] mz-tx3 mt-1 block font-light">{hint}</span>}
    </label>
  );
}

/* A number field that keeps what you typed.
   `type="number"` bound to `Number(e.target.value)` throws away "1." the
   moment you type the dot, and turns a cleared field into 0 — so clearing a
   balance to retype it silently zeroed the account. This keeps the raw string
   while focused and only converts on the way out. */
export function NumberInput({ value, onChange, className = "", allowEmpty = true, ...rest }) {
  const [draft, setDraft] = useState(value == null || value === "" ? "" : String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (focused.current) return; // never yank the field out from under the cursor
    setDraft(value == null || value === "" ? "" : String(value));
  }, [value]);

  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={draft}
      className={className || inputCls + " font-mono"}
      onFocus={(e) => { focused.current = true; rest.onFocus && rest.onFocus(e); }}
      onBlur={(e) => {
        focused.current = false;
        const n = draft.trim() === "" ? (allowEmpty ? "" : 0) : Number(draft.replace(/,/g, ""));
        if (draft.trim() !== "" && !isFinite(n)) { setDraft(value == null ? "" : String(value)); return; }
        setDraft(n === "" ? "" : String(n));
        onChange(n);
        rest.onBlur && rest.onBlur(e);
      }}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw !== "" && !/^-?[\d,]*\.?\d*$/.test(raw)) return; // reject letters, keep the rest
        setDraft(raw);
        const n = raw.trim() === "" ? (allowEmpty ? "" : 0) : Number(raw.replace(/,/g, ""));
        if (raw.trim() === "" || isFinite(n)) onChange(n);
      }}
    />
  );
}

export function Segmented({ options, value, onChange, className = "" }) {
  return (
    <div className={"flex gap-1 mz-sub rounded-full p-1 " + className} role="tablist">
      {options.map(([k, l]) => (
        <button
          key={k}
          role="tab"
          aria-selected={value === k}
          onClick={() => onChange(k)}
          className={"flex-1 text-xs py-1.5 rounded-full transition-colors " + (value === k ? "mz-btn-primary" : "mz-tx2 mz-hovi font-medium")}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

/* Modal overlay: bottom sheet on phones, centered dialog on wider screens.

   Rendered through a portal because ancestors inside the tab views carry CSS
   transforms (entrance animations, card hover lift), and a transformed
   ancestor turns position:fixed into position-relative-to-that-ancestor —
   which pushed modals down the page and sometimes off-screen.

   Focus is trapped and restored: without it, tabbing out of an open dialog
   lands on the page behind it, which for a screen-reader user means the dialog
   effectively vanishes. */
export function Modal({ title, onClose, children, wide = false }) {
  const panel = useRef(null);
  const restoreTo = useRef(null);
  const titleId = useId();

  useEffect(() => {
    restoreTo.current = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // lock page scroll behind the dialog

    const focusables = () =>
      Array.from(
        panel.current?.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])') || []
      ).filter((el) => el.offsetParent !== null);

    const t = setTimeout(() => {
      const f = focusables();
      (f[0] || panel.current)?.focus();
    }, 0);

    const onKey = (e) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab") return;
      const f = focusables();
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      if (restoreTo.current && restoreTo.current.focus) restoreTo.current.focus();
    };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="absolute inset-0 mz-backdrop" onClick={onClose} />
      <div
        ref={panel}
        tabIndex={-1}
        className={"mz-modal relative w-full max-h-[85vh] overflow-y-auto rounded-[26px] p-5 " + (wide ? "max-w-lg" : "max-w-md")}
        /* the sheet carries the field with it rather than being a pale panel
           punched through it — same ground, lifted one step */
        style={{ background: "var(--bg-solid)", backgroundImage: "var(--bg)", border: "1px solid var(--line)", color: "var(--ink)" }}
      >
        <div className="flex items-center justify-between mb-3">
          <div id={titleId}><CardTitle>{title}</CardTitle></div>
          <button onClick={onClose} aria-label="Close" className="mz-iconbtn mz-tx3 -mr-2"><X size={16} strokeWidth={2} /></button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}

/* Confirm before anything that destroys data. */
export function ConfirmButton({ label, confirmLabel, onConfirm, className = "", danger = true }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 5000); // disarm rather than lurk
    return () => clearTimeout(t);
  }, [armed]);
  if (!armed) {
    return (
      <button onClick={() => setArmed(true)} className={className || (danger ? "text-sm mz-txrose font-medium" : "text-sm mz-tx2")}>
        {label}
      </button>
    );
  }
  return (
    <span className="flex gap-2 items-center">
      <button
        onClick={() => { setArmed(false); onConfirm(); }}
        className="flex-1 text-sm font-medium py-2.5 px-3 rounded-full"
        style={{ background: "var(--flow-out)", color: "var(--bg-solid)" }}
      >
        {confirmLabel || "Yes, do it"}
      </button>
      <button onClick={() => setArmed(false)} className="px-4 text-sm mz-tx2">Cancel</button>
    </span>
  );
}

/* count-up: eases a number toward its new value.

   Kept in its own component so the ~60 state updates a second it produces
   re-render one <span> instead of the whole hero card and its sparkline.

   The decoration must never cost correctness. Browsers pause
   requestAnimationFrame in tabs that aren't compositing — a backgrounded tab,
   a restored session — and an animation that never ticks leaves the figure
   frozen at where it started, which for the net-worth hero means showing zero
   while the rest of the card shows real money. So: skip the animation
   outright when the page is hidden, and back every run with a timer that
   lands the true value whatever the frame loop does. */
export function CountUp({ value, format, dur = 600, className, style }) {
  const [disp, setDisp] = useState(value);
  const prev = useRef(value);

  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
    const from = prev.current;
    const to = value;
    prev.current = value;

    if (reduce || hidden || from === to || typeof requestAnimationFrame === "undefined") {
      setDisp(value);
      return;
    }

    let raf;
    const t0 = performance.now();
    const settle = setTimeout(() => setDisp(to), dur + 80); // the guarantee
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      setDisp(from + (to - from) * e);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); clearTimeout(settle); };
  }, [value, dur]);

  return <span className={className} style={style}>{format ? format(disp) : Math.round(disp)}</span>;
}

export function EmptyNote({ children }) {
  return <div className="text-sm mz-tx3 py-6 text-center">{children}</div>;
}

export function Pill({ children, color = ACCENT, title }) {
  return (
    <span
      className="text-[10px] uppercase px-2.5 py-1 rounded-full whitespace-nowrap"
      title={title}
      style={{ fontFamily: MONO_FONT, fontWeight: 600, letterSpacing: "0.16em", color, background: color + "1F" }}
    >
      {children}
    </span>
  );
}
