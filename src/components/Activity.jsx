/* Activity tab: quick add, the transaction ledger, and recurring rules. */

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRightLeft, ArrowDownToLine, Plus, Pencil, Trash2, X, Search,
  Camera, Mic, Repeat, CalendarClock,
} from "lucide-react";
import { Card, CardTitle, Field, Modal, NumberInput, Segmented, inputCls, useToast, useAI, EmptyNote } from "./ui.jsx";
import { fmtEGP, fmtNum, relativeDay } from "../lib/format.js";
import { snapshotSides, sideName, sideUnitLabel, unitLabel, findAcc, outEgp } from "../lib/valuation.js";
import { parseEntry, localParseMany, withTimeout } from "../lib/parse.js";
import { allDue, afterOccurrence, occurrenceToTxn, newRule, FREQUENCIES } from "../lib/recurring.js";
import { TAXONOMY, MAIN_CATS, uid, touch, tombstone, live } from "../../shared/model.js";
import { ACCENT, catIcon, MONO_FONT, TEAL, ROSE, AMBER } from "../theme.js";

const PAGE = 40;

/* ---------- category input ---------- */
function CategoryPicker({ category, subcategory, setCategory, setSub }) {
  const subs = TAXONOMY[category] || [];
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label="Category">
        <input className={inputCls} list="mz-maincats" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Food" />
        <datalist id="mz-maincats">{MAIN_CATS.map((c) => <option key={c} value={c} />)}</datalist>
      </Field>
      <Field label="Subcategory">
        <input className={inputCls} list="mz-subcats" value={subcategory} onChange={(e) => setSub(e.target.value)} placeholder={subs.length ? subs[0] : "optional"} />
        <datalist id="mz-subcats">{subs.map((s) => <option key={s} value={s} />)}</datalist>
      </Field>
    </div>
  );
}

/* ---------- manual / review form ---------- */
function TxnForm({ accs, onAdd, initial = {}, submitLabel = "Log it" }) {
  const today = new Date().toISOString().slice(0, 10);
  const [type, setType] = useState(initial.type || "expense");
  const [fromId, setFromId] = useState(initial.fromId || accs[0]?.id);
  const [toId, setToId] = useState(initial.toId || accs[1]?.id || accs[0]?.id);
  const [fromAmount, setFromAmount] = useState(initial.fromAmount != null && initial.fromAmount !== 0 ? initial.fromAmount : "");
  const [toAmount, setToAmount] = useState(initial.toAmount != null ? initial.toAmount : "");
  const [category, setCategory] = useState(initial.category || "");
  const [subcategory, setSubcategory] = useState(initial.subcategory || "");
  const [note, setNote] = useState(initial.note || "");
  const [date, setDate] = useState(initial.date || today);
  const [err, setErr] = useState(null);

  const fromAcc = findAcc(accs, fromId);
  const toAcc = findAcc(accs, toId);
  const sameUnit = fromAcc && toAcc && fromAcc.unit === toAcc.unit;

  function submit() {
    const fa = Number(fromAmount) || 0;
    const ta = type === "transfer" ? (sameUnit ? fa : Number(toAmount) || 0) : type === "income" ? Number(toAmount || fromAmount) || 0 : fa;
    if (type === "income" && !ta) { setErr("Enter the amount received."); return; }
    if (type !== "income" && !fa) { setErr("Enter the amount."); return; }
    if (type === "transfer" && fromId === toId) { setErr("A transfer needs two different accounts."); return; }
    onAdd({
      id: initial.id || uid(),
      date,
      type,
      fromId: type === "income" ? null : fromId,
      toId: type === "expense" ? null : toId,
      fromAmount: fa,
      toAmount: ta,
      category,
      subcategory,
      note,
    });
  }

  return (
    <div>
      <Segmented
        className="mb-3"
        options={[["expense", "Expense"], ["income", "Income"], ["transfer", "Transfer / Buy"]]}
        value={type}
        onChange={setType}
      />
      <div className="space-y-2">
        {type !== "income" && (
          <Field label={type === "transfer" ? "From" : "Account"}>
            <select className={inputCls} value={fromId} onChange={(e) => setFromId(e.target.value)}>
              {accs.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
        )}
        {type !== "expense" && (
          <Field label={type === "transfer" ? "To" : "Into account"}>
            <select className={inputCls} value={toId} onChange={(e) => setToId(e.target.value)}>
              {accs.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
        )}
        {type !== "income" && (
          <Field label={`Amount out (${unitLabel(fromAcc)})`}>
            <NumberInput value={fromAmount} onChange={setFromAmount} />
          </Field>
        )}
        {((type === "transfer" && !sameUnit) || type === "income") && (
          <Field label={`Amount in (${unitLabel(toAcc)})`}>
            <NumberInput value={toAmount} onChange={setToAmount} />
          </Field>
        )}
        <CategoryPicker category={category} subcategory={subcategory} setCategory={setCategory} setSub={setSubcategory} />
        <div className="grid grid-cols-2 gap-2">
          <Field label="Date"><input type="date" className={inputCls + " font-mono"} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Note"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" /></Field>
        </div>
        {err && <div className="text-[11px] mz-txrose border mz-note-rose rounded-lg p-2">{err}</div>}
        <button onClick={submit} className="w-full mz-btn-primary text-sm font-medium py-2 rounded-lg mt-1">{submitLabel}</button>
      </div>
    </div>
  );
}

/* ---------- quick add ---------- */
function QuickAdd({ accs, onParsed, focusSignal }) {
  const callAI = useAI();
  const [text, setText] = useState("");
  const [image, setImage] = useState(null);
  const [payFrom, setPayFrom] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [listening, setListening] = useState(false);
  const recRef = useRef(null);
  const taRef = useRef(null);

  useEffect(() => {
    if (focusSignal && taRef.current) taRef.current.focus();
  }, [focusSignal]);

  // stop a live recogniser if the user navigates away mid-dictation
  useEffect(() => () => { try { recRef.current && recRef.current.stop(); } catch {} }, []);

  function onFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!/^image\/(jpeg|png|gif|webp)$/.test(file.type)) { setErr("Use a JPG, PNG, GIF or WEBP image."); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const mm = /^data:(.+);base64,(.*)$/.exec(String(reader.result));
      if (mm) setImage({ media: mm[1], data: mm[2], name: file.name });
    };
    reader.readAsDataURL(file);
  }

  function toggleMic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setErr("In-app voice isn't available here. Tap your keyboard's mic and dictate straight into the box — that always works.");
      return;
    }
    if (listening) { recRef.current && recRef.current.stop(); return; }
    const rec = new SR();
    rec.lang = navigator.language || "en-US";
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (ev) => setText((p) => (p ? p + " " : "") + ev.results[0][0].transcript);
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recRef.current = rec;
    setErr(null);
    try { rec.start(); setListening(true); }
    catch { setListening(false); setErr("Couldn't start the mic here. Use your keyboard's mic instead."); }
  }

  async function parse() {
    if (!text.trim() && !image) { setErr("Type a note, dictate one, or attach a receipt first."); return; }
    setBusy(true);
    setErr(null);
    try {
      const fields = await withTimeout(parseEntry(accs, { text: text.trim(), image, payFrom: payFrom || undefined }, callAI), 25000);
      onParsed(fields);
      setText("");
      setImage(null);
    } catch {
      if (!image && text.trim()) {
        onParsed(localParseMany(accs, text.trim()));
        setText("");
        setErr("AI wasn't reachable, so I did a quick offline read — check each one before saving.");
      } else {
        setErr("Reading a receipt needs an AI provider. Add a Gemini key in Settings, or type the details and I'll parse them offline.");
      }
    }
    setBusy(false);
  }

  return (
    <Card>
      <CardTitle>Quick add</CardTitle>
      <p className="text-[12px] mz-tx2 mt-1 mb-2">
        Write it however you'd say it — and list several at once: "lunch 250 cash, coffee 80, salary 95k into Clouds". Tap Parse and you review them before saving.
      </p>
      <textarea
        ref={taRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder="e.g. spent 250 on coffee, cash"
        className="w-full mz-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 resize-none"
      />
      {image && (
        <>
          <div className="flex items-center justify-between mt-2 text-[11px] font-mono border mz-note-mut rounded-lg px-2 py-1.5">
            <span className="truncate">📎 {image.name}</span>
            <button onClick={() => setImage(null)} className="mz-tx3 mz-hovrose ml-2">remove</button>
          </div>
          <div className="mt-2">
            <span className="text-[11px] font-mono uppercase tracking-wide mz-tx3">Paid from</span>
            <select value={payFrom} onChange={(e) => setPayFrom(e.target.value)} className="w-full mt-1 mz-input rounded-lg px-3 py-2 text-sm">
              <option value="">auto-detect</option>
              {accs.filter((a) => !a.isLiability && a.unit !== "GOLD").map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <p className="text-[11px] mz-tx3 mt-1">A grocery receipt splits into separate transactions by category (food vs household, etc.) — all from this account, for you to review.</p>
          </div>
        </>
      )}
      {err && <div className="mt-2 text-[11px] mz-txrose border mz-note-rose rounded-lg p-2">{err}</div>}
      <div className="flex items-center gap-2 mt-2">
        <button
          onClick={toggleMic}
          aria-pressed={listening}
          className={"text-xs font-mono px-3 py-1.5 rounded-lg border inline-flex items-center gap-1.5 " + (listening ? "border-rose-300 mz-txrose mz-pulse" : "mz-btn-ghost")}
        >
          <Mic size={13} strokeWidth={2} /> {listening ? "listening…" : "dictate"}
        </button>
        <label className="relative text-xs font-mono px-3 py-1.5 rounded-lg mz-btn-ghost cursor-pointer overflow-hidden inline-flex items-center gap-1.5">
          <Camera size={13} strokeWidth={2} /> receipt
          <input type="file" accept="image/*" onChange={onFile} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
        </label>
        <button onClick={parse} disabled={busy} className="flex-1 text-sm font-medium px-3 py-2 rounded-lg mz-btn-primary">
          {busy ? "reading…" : "Parse"}
        </button>
      </div>
    </Card>
  );
}

/* ---------- recurring rules ---------- */
function RecurringCard({ rules, accs, today, onLog, onSkip, onSave, onDelete }) {
  const [editing, setEditing] = useState(null);
  const due = useMemo(() => allDue(rules, today), [rules, today]);

  return (
    <Card>
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-2">
          <Repeat size={14} strokeWidth={2} className="mz-tx2" />
          <CardTitle>Recurring</CardTitle>
        </span>
        <button onClick={() => setEditing(newRule({ fromId: accs[0]?.id, toId: accs[0]?.id }))} className="text-xs font-mono px-3 py-1.5 rounded-lg mz-btn-ghost">
          + rule
        </button>
      </div>

      {due.length > 0 && (
        <div className="mt-3 rounded-xl border mz-note-blue p-3">
          <div className="text-[11px] font-mono uppercase tracking-widest mz-txblue inline-flex items-center gap-1.5">
            <CalendarClock size={12} strokeWidth={2} /> {due.length} due
          </div>
          <div className="mt-2 space-y-2">
            {due.map((occ) => (
              <div key={occ.ruleId + occ.date} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{occ.rule.label || occ.rule.category || occ.rule.type}</div>
                  <div className="text-[11px] font-mono mz-tx3">{occ.date} · {fmtNum(occ.rule.fromAmount || occ.rule.toAmount || 0, 0)}</div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => onLog(occ)} className="text-[11px] font-mono px-2.5 py-1.5 rounded-lg mz-btn-primary">log</button>
                  <button onClick={() => onSkip(occ)} className="text-[11px] font-mono px-2 py-1.5 rounded-lg mz-btn-ghost">skip</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {rules.length === 0 ? (
        <p className="text-[12px] mz-tx2 mt-2">
          Rent, salary, subscriptions — add a rule and Mizan will offer the entry when it falls due. Nothing is written without your confirmation.
        </p>
      ) : (
        <div className="divide-y mz-dv mt-2">
          {rules.map((r) => (
            <div key={r.id} className="flex items-center justify-between py-2 gap-2">
              <button onClick={() => setEditing(r)} className="text-left min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{r.label || r.category || r.type}</div>
                <div className="text-[11px] font-mono mz-tx3 truncate">
                  {(FREQUENCIES.find(([k]) => k === r.freq) || [, r.freq])[1]} · next {r.nextDate}{r.paused ? " · paused" : ""}
                </div>
              </button>
              <div className="flex items-center gap-1 shrink-0">
                <span className="font-mono tabular-nums text-sm mz-tx2">{fmtNum(r.fromAmount || r.toAmount || 0, 0)}</span>
                <button onClick={() => onDelete(r)} aria-label="Delete rule" className="mz-iconbtn mz-tx3 mz-hovrose -mr-2"><Trash2 size={14} strokeWidth={2} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <Modal title={rules.some((r) => r.id === editing.id) ? "Edit rule" : "New recurring rule"} onClose={() => setEditing(null)}>
          <RuleForm rule={editing} accs={accs} onSave={(r) => { onSave(r); setEditing(null); }} onCancel={() => setEditing(null)} />
        </Modal>
      )}
    </Card>
  );
}

function RuleForm({ rule, accs, onSave, onCancel }) {
  const [f, setF] = useState({ ...rule });
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  return (
    <div className="space-y-2">
      <Field label="Label"><input className={inputCls} value={f.label} onChange={(e) => set("label", e.target.value)} placeholder="e.g. Rent" /></Field>
      <Segmented options={[["expense", "Expense"], ["income", "Income"], ["transfer", "Transfer"]]} value={f.type} onChange={(v) => set("type", v)} />
      {f.type !== "income" && (
        <Field label="From account">
          <select className={inputCls} value={f.fromId || ""} onChange={(e) => set("fromId", e.target.value)}>
            {accs.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
      )}
      {f.type !== "expense" && (
        <Field label="To account">
          <select className={inputCls} value={f.toId || ""} onChange={(e) => set("toId", e.target.value)}>
            {accs.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Amount"><NumberInput value={f.type === "income" ? f.toAmount ?? "" : f.fromAmount} onChange={(v) => (f.type === "income" ? set("toAmount", v) : set("fromAmount", v))} /></Field>
        <Field label="Frequency">
          <select className={inputCls} value={f.freq} onChange={(e) => set("freq", e.target.value)}>
            {FREQUENCIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Next occurrence"><input type="date" className={inputCls + " font-mono"} value={f.nextDate} onChange={(e) => set("nextDate", e.target.value)} /></Field>
      <CategoryPicker category={f.category} subcategory={f.subcategory} setCategory={(v) => set("category", v)} setSub={(v) => set("subcategory", v)} />
      <label className="flex items-center gap-2 text-sm mz-tx2 pt-1">
        <input type="checkbox" checked={!!f.paused} onChange={(e) => set("paused", e.target.checked)} />
        Paused — stop proposing this for now
      </label>
      <div className="flex gap-2 pt-2">
        <button onClick={() => onSave(f)} className="flex-1 mz-btn-primary text-sm font-medium py-2 rounded-lg">Save rule</button>
        <button onClick={onCancel} className="px-4 text-sm mz-tx2">Cancel</button>
      </div>
    </div>
  );
}

/* ---------- ledger row ---------- */
function TxnRow({ t, accs, onEdit, onDelete }) {
  const color = t.type === "income" ? TEAL : t.type === "expense" ? ROSE : "#64748B";
  const RIcon = t.type === "transfer" ? ArrowRightLeft : t.type === "income" ? ArrowDownToLine : catIcon(t.category);
  const fromLabel = sideName(t, "from", accs);
  const toLabel = sideName(t, "to", accs);
  const missingFrom = t.fromId && !findAcc(accs, t.fromId);
  const missingTo = t.toId && !findAcc(accs, t.toId);

  return (
    <div className="flex items-center justify-between py-2 gap-2">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg shrink-0" style={{ background: color + "16", color }}>
          <RIcon size={15} strokeWidth={2} />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">
            {t.category || (t.type === "transfer" ? "Transfer" : t.type)}
            {t.subcategory ? <span className="mz-tx3 font-normal"> · {t.subcategory}</span> : null}
          </div>
          <div className="text-[11px] font-mono mz-tx3 truncate">
            {t.type === "income" ? `→ ${toLabel}` : t.type === "expense" ? `${fromLabel} →` : `${fromLabel} → ${toLabel}`}
            {(missingFrom || missingTo) && <span style={{ color: AMBER }}> · removed</span>}
            {t.note ? ` · ${t.note}` : ""}
          </div>
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="font-mono tabular-nums text-sm" style={{ color }}>
          {t.type === "transfer"
            ? `${fmtNum(t.fromAmount, 2)}${sideUnitLabel(t, "from", accs)} → ${fmtNum(t.toAmount, 2)}${sideUnitLabel(t, "to", accs)}`
            : t.type === "income"
            ? `+${fmtNum(t.toAmount, 2)}${sideUnitLabel(t, "to", accs)}`
            : `−${fmtNum(t.fromAmount, 2)}${sideUnitLabel(t, "from", accs)}`}
        </div>
        <div className="flex items-center justify-end gap-0.5 -mr-2">
          <button onClick={() => onEdit(t)} aria-label="Edit transaction" className="mz-iconbtn mz-tx3 mz-hovblue"><Pencil size={15} strokeWidth={2} /></button>
          <button onClick={() => onDelete(t)} aria-label="Delete transaction" className="mz-iconbtn mz-tx3 mz-hovrose"><Trash2 size={15} strokeWidth={2} /></button>
        </div>
      </div>
    </div>
  );
}

/* ---------- tab ---------- */
export default function Activity({ state, setState, prices, focusSignal, onNavigate }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [parsed, setParsed] = useState(null);
  const [formKey, setFormKey] = useState(0);
  const [pending, setPending] = useState([]);
  const [warn, setWarn] = useState([]);
  const [editTxn, setEditTxn] = useState(null);
  const [query, setQuery] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [limit, setLimit] = useState(PAGE);

  const accs = useMemo(() => live(state, "accounts"), [state]);
  const txns = useMemo(() => live(state, "transactions"), [state]);
  const rules = useMemo(() => live(state, "recurring"), [state]);
  const today = new Date().toISOString().slice(0, 10);

  /* ---- balance arithmetic ---- */
  const applyDelta = (accounts, id, delta) =>
    accounts.map((a) => (a.id === id ? touch({ ...a, balance: (Number(a.balance) || 0) + delta }) : a));

  const applyTxn = (accounts, t) => {
    if (t.type === "income") return applyDelta(accounts, t.toId, t.toAmount);
    if (t.type === "expense") return applyDelta(accounts, t.fromId, -t.fromAmount);
    return applyDelta(applyDelta(accounts, t.fromId, -t.fromAmount), t.toId, t.toAmount);
  };
  const reverseTxn = (accounts, t) => {
    if (t.type === "income") return applyDelta(accounts, t.toId, -t.toAmount);
    if (t.type === "expense") return applyDelta(accounts, t.fromId, t.fromAmount);
    return applyDelta(applyDelta(accounts, t.fromId, t.fromAmount), t.toId, -t.toAmount);
  };

  /* Fill in toAmount sensibly, then freeze the exchange rates that applied
     today — the whole point of snapshotSides. */
  function normalize(t0) {
    const from = findAcc(accs, t0.fromId);
    const to = findAcc(accs, t0.toId);
    const sameUnit = from && to && from.unit === to.unit;
    const fa = Number(t0.fromAmount) || 0;
    let ta;
    if (t0.type === "income") ta = Number(t0.toAmount != null ? t0.toAmount : t0.fromAmount) || 0;
    else if (t0.type === "transfer") ta = t0.toAmount != null ? Number(t0.toAmount) : sameUnit ? fa : 0;
    else ta = fa;
    const base = {
      id: t0.id || uid(),
      date: t0.date || today,
      type: t0.type,
      fromId: t0.type === "income" ? null : t0.fromId,
      toId: t0.type === "expense" ? null : t0.toId,
      fromAmount: fa,
      toAmount: ta,
      category: t0.category || "",
      subcategory: t0.subcategory || "",
      note: t0.note || "",
    };
    return touch(snapshotSides(base, accs, prices));
  }

  /* ---- budget warnings ---- */
  function checkBudgets(committed) {
    const budgets = state.budgets || {};
    const ym = today.slice(0, 7);
    const exp = committed.filter((t) => t.type === "expense" && (t.date || "").slice(0, 7) === ym);
    if (!exp.length) return;
    const touched = new Set(exp.map((t) => t.category || "Uncategorized"));
    const all = [...committed, ...txns].filter((t) => t.type === "expense" && (t.date || "").slice(0, 7) === ym);
    const spentBy = {};
    all.forEach((t) => {
      const c = t.category || "Uncategorized";
      spentBy[c] = (spentBy[c] || 0) + outEgp(t, accs, prices);
    });
    const msgs = [];
    touched.forEach((c) => {
      const b = budgets[c];
      if (!b) return;
      const r = (spentBy[c] || 0) / b;
      if (r > 1) msgs.push(`${c}: over budget — ${fmtEGP(spentBy[c])} of ${fmtEGP(b)} this month`);
      else if (r >= 0.8) msgs.push(`${c}: ${Math.round(r * 100)}% of ${fmtEGP(b)} budget — ${fmtEGP(b - spentBy[c])} left`);
    });
    if (msgs.length) setWarn(msgs);
  }

  const txnLabel = (t) => {
    if (t.type === "income") return "+" + fmtNum(t.toAmount, 0) + sideUnitLabel(t, "to", accs);
    if (t.type === "expense") return "−" + fmtNum(t.fromAmount, 0) + sideUnitLabel(t, "from", accs);
    return "transfer";
  };

  /* ---- mutations ---- */
  function addTxn(raw) {
    const t = normalize(raw);
    setState((s) => ({ ...s, accounts: applyTxn(s.accounts, t), transactions: [t, ...s.transactions] }));
    setOpen(false);
    setParsed(null);
    checkBudgets([t]);
    toast("Logged · " + (t.category || (t.type === "transfer" ? "Transfer" : t.type)) + " " + txnLabel(t));
  }

  function addMany(list) {
    const norm = list.map(normalize);
    setState((s) => {
      let accounts = s.accounts;
      norm.forEach((t) => (accounts = applyTxn(accounts, t)));
      return { ...s, accounts, transactions: [...norm.slice().reverse(), ...s.transactions] };
    });
    setPending([]);
    checkBudgets(norm);
    toast("Logged " + norm.length + " transactions");
  }

  function commitEdit(raw) {
    const old = editTxn;
    const nt = normalize({ ...raw, id: old.id });
    setState((s) => {
      let accounts = reverseTxn(s.accounts, old);
      accounts = applyTxn(accounts, nt);
      return { ...s, accounts, transactions: s.transactions.map((x) => (x.id === old.id ? nt : x)) };
    });
    setEditTxn(null);
    checkBudgets([nt]);
    toast("Updated · " + (nt.category || nt.type) + " " + txnLabel(nt));
  }

  function delTxn(t) {
    setState((s) => ({
      ...s,
      accounts: reverseTxn(s.accounts, t),
      transactions: s.transactions.map((x) => (x.id === t.id ? tombstone(x) : x)),
    }));
    toast("Deleted · " + (t.category || t.type) + " " + txnLabel(t), {
      undo: () => setState((s) => ({
        ...s,
        accounts: applyTxn(s.accounts, t),
        transactions: s.transactions.map((x) => (x.id === t.id ? touch({ ...x, deletedAt: undefined }) : x)),
      })),
    });
  }

  /* ---- recurring ---- */
  const saveRule = (r) => setState((s) => {
    const exists = (s.recurring || []).some((x) => x.id === r.id);
    const next = touch(r);
    return { ...s, recurring: exists ? s.recurring.map((x) => (x.id === r.id ? next : x)) : [...(s.recurring || []), next] };
  });
  const deleteRule = (r) => {
    setState((s) => ({ ...s, recurring: (s.recurring || []).map((x) => (x.id === r.id ? tombstone(x) : x)) }));
    toast("Rule removed · " + (r.label || r.type));
  };
  function advanceRule(occ) {
    const next = afterOccurrence(occ.rule, occ.date);
    setState((s) => ({ ...s, recurring: (s.recurring || []).map((x) => (x.id === occ.ruleId ? touch({ ...x, nextDate: next }) : x)) }));
  }
  function logOccurrence(occ) {
    const t = normalize(occurrenceToTxn(occ));
    setState((s) => ({
      ...s,
      accounts: applyTxn(s.accounts, t),
      transactions: [t, ...s.transactions],
      recurring: (s.recurring || []).map((x) => (x.id === occ.ruleId ? touch({ ...x, nextDate: afterOccurrence(occ.rule, occ.date) }) : x)),
    }));
    checkBudgets([t]);
    toast("Logged · " + (occ.rule.label || t.category || t.type));
  }

  /* ---- parsed-entry plumbing ---- */
  function onParsed(fields) {
    const list = Array.isArray(fields) ? fields : [fields];
    if (list.length <= 1) {
      setParsed(list[0] || null);
      setFormKey((k) => k + 1);
      setOpen(true);
      setPending([]);
    } else {
      setPending(list.map((f) => ({ ...f, _k: uid() })));
      setOpen(false);
      setParsed(null);
    }
  }
  function editPending(p) {
    setParsed(p);
    setFormKey((k) => k + 1);
    setOpen(true);
    setPending((l) => l.filter((x) => x._k !== p._k));
  }

  /* ---- search + windowing ----
     The ledger used to render every transaction on every state change. With a
     year of daily spending that is thousands of nodes rebuilt whenever a
     balance moves; now it filters first and grows a page at a time. */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return txns.filter((t) => {
      if (filterType !== "all" && t.type !== filterType) return false;
      if (!q) return true;
      const hay = [t.category, t.subcategory, t.note, t.date, sideName(t, "from", accs), sideName(t, "to", accs), String(t.fromAmount), String(t.toAmount)]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [txns, query, filterType, accs]);

  const visible = filtered.slice(0, limit);
  const grouped = useMemo(() => {
    const g = [];
    let cur = null;
    visible.forEach((t) => {
      if (!cur || cur.d !== t.date) { cur = { d: t.date, items: [] }; g.push(cur); }
      cur.items.push(t);
    });
    return g;
  }, [visible]);

  useEffect(() => { setLimit(PAGE); }, [query, filterType]);

  /* clean slate: transactions need an account to move money in or out of */
  if (accs.length === 0) {
    return (
      <div className="space-y-3">
        <Card>
          <div className="text-center py-3">
            <div className="mx-auto w-11 h-11 rounded-2xl flex items-center justify-center mb-2.5" style={{ background: ACCENT + "1A", color: ACCENT }}>
              <ArrowRightLeft size={20} strokeWidth={2} />
            </div>
            <div className="text-sm font-semibold mz-tx1">No accounts yet</div>
            <p className="text-[12px] mz-tx2 mt-1 max-w-xs mx-auto">Transactions move money between accounts, so add at least one first — then log spending here in plain language.</p>
            <button onClick={() => onNavigate("accounts")} className="mz-btn-primary inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-xl mt-3">
              <Plus size={15} strokeWidth={2.4} /> Add an account
            </button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {warn.length > 0 && (
        <div className="rounded-xl border mz-note-amber p-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono uppercase tracking-widest mz-txamber">⚠ budget alert</span>
            <button onClick={() => setWarn([])} className="text-[11px] font-mono mz-txamber">dismiss</button>
          </div>
          <div className="mt-1 space-y-0.5">
            {warn.map((w, i) => <div key={i} className="text-sm mz-txamber2">{w}</div>)}
          </div>
        </div>
      )}

      <QuickAdd accs={accs} onParsed={onParsed} focusSignal={focusSignal} />

      {pending.length > 0 && (
        <Card>
          <div className="flex items-center justify-between">
            <CardTitle>Review {pending.length} parsed</CardTitle>
            <button onClick={() => setPending([])} className="text-[11px] font-mono mz-tx3 mz-hovrose">discard all</button>
          </div>
          <div className="divide-y mz-dv mt-1">
            {pending.map((p) => {
              const from = findAcc(accs, p.fromId);
              const to = findAcc(accs, p.toId);
              const needsAmt = !p.fromAmount && !p.toAmount;
              const amt =
                p.type === "income" ? `+${fmtNum(p.toAmount || 0, 2)}${unitLabel(to)}`
                : p.type === "transfer" ? `${fmtNum(p.fromAmount || 0, 2)}${unitLabel(from)} → ${p.toAmount != null ? fmtNum(p.toAmount, 2) + unitLabel(to) : "?"}`
                : `−${fmtNum(p.fromAmount || 0, 2)}${unitLabel(from)}`;
              return (
                <div key={p._k} className="flex items-center justify-between py-2 gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {p.category || (p.type === "transfer" ? "Transfer" : p.type)}
                      {p.subcategory ? <span className="mz-tx3 font-normal"> · {p.subcategory}</span> : null}
                      {needsAmt && <span className="ml-2 text-[10px] font-mono" style={{ color: AMBER }}>needs amount</span>}
                    </div>
                    <div className="text-[11px] font-mono mz-tx3 truncate">
                      {p.date} · {p.type === "income" ? `→ ${to?.name}` : p.type === "expense" ? `${from?.name} →` : `${from?.name} → ${to?.name}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono tabular-nums text-sm">{amt}</span>
                    <button onClick={() => editPending(p)} aria-label="Edit parsed item" className="mz-iconbtn mz-tx2 mz-hovblue"><Pencil size={14} strokeWidth={2} /></button>
                    <button onClick={() => setPending((l) => l.filter((x) => x._k !== p._k))} aria-label="Discard parsed item" className="mz-iconbtn mz-tx3 mz-hovrose"><X size={15} strokeWidth={2} /></button>
                  </div>
                </div>
              );
            })}
          </div>
          <button onClick={() => addMany(pending)} className="w-full mt-3 mz-btn-primary text-sm font-medium py-2 rounded-lg">Add all {pending.length}</button>
        </Card>
      )}

      <button
        onClick={() => { setParsed(null); setFormKey((k) => k + 1); setOpen(true); }}
        className="w-full text-sm font-medium py-2.5 rounded-xl mz-btn-ghost"
      >
        Or fill it in by hand
      </button>

      {open && (
        <Modal title={parsed ? "Review parsed entry" : "Log manually"} onClose={() => { setOpen(false); setParsed(null); }}>
          {parsed && (
            <div className="text-[11px] font-mono mz-txteal border mz-note-teal rounded-lg px-3 py-2 mb-3">
              Parsed from your note — check the fields and save.
            </div>
          )}
          <TxnForm key={formKey} accs={accs} onAdd={addTxn} initial={parsed || {}} />
        </Modal>
      )}

      {editTxn && (
        <Modal title="Edit transaction" onClose={() => setEditTxn(null)}>
          <div className="text-[11px] font-mono mz-txblue border mz-note-blue rounded-lg px-3 py-2 mb-3">
            Balances re-apply on save — the old amounts are reversed first.
          </div>
          <TxnForm key={"edit-" + editTxn.id} accs={accs} onAdd={commitEdit} initial={editTxn} submitLabel="Save changes" />
        </Modal>
      )}

      <RecurringCard
        rules={rules}
        accs={accs}
        today={today}
        onLog={logOccurrence}
        onSkip={advanceRule}
        onSave={saveRule}
        onDelete={deleteRule}
      />

      <Card>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Recent activity</CardTitle>
          <span className="text-[11px] font-mono mz-tx3">{filtered.length} of {txns.length}</span>
        </div>

        {txns.length > 0 && (
          <div className="mt-2 space-y-2">
            <div className="relative">
              <Search size={14} strokeWidth={2} className="absolute left-3 top-1/2 -translate-y-1/2 mz-tx3 pointer-events-none" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="search category, note, account, amount…"
                className={inputCls + " pl-9"}
                type="search"
              />
            </div>
            <Segmented
              options={[["all", "All"], ["expense", "Out"], ["income", "In"], ["transfer", "Moves"]]}
              value={filterType}
              onChange={setFilterType}
            />
          </div>
        )}

        {txns.length === 0 ? (
          <EmptyNote>
            Nothing logged yet. A transfer moves value between accounts — use it for a gold buy (EGP out → grams in) or an FX swap.
          </EmptyNote>
        ) : filtered.length === 0 ? (
          <EmptyNote>Nothing matches that search.</EmptyNote>
        ) : (
          <>
            <div className="mt-1">
              {grouped.map((g) => (
                <div key={g.d}>
                  <div className="mz-daybar text-[10px] uppercase tracking-widest mz-tx3 py-1.5" style={{ fontFamily: MONO_FONT }}>
                    {relativeDay(g.d)}
                  </div>
                  <div className="divide-y mz-dv">
                    {g.items.map((t) => <TxnRow key={t.id} t={t} accs={accs} onEdit={(x) => { setEditTxn(x); setOpen(false); setParsed(null); }} onDelete={delTxn} />)}
                  </div>
                </div>
              ))}
            </div>
            {filtered.length > limit && (
              <button onClick={() => setLimit((l) => l + PAGE)} className="w-full mt-3 text-sm font-medium py-2 rounded-lg mz-btn-ghost">
                Show {Math.min(PAGE, filtered.length - limit)} more
              </button>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
