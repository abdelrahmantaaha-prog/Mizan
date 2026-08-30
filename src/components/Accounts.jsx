/* Accounts tab: holdings, bulk balance sync, and the debt ledger. */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Building2, Trash2, Check, Camera } from "lucide-react";
import { Card, CardTitle, Field, Modal, NumberInput, Segmented, inputCls, useToast, useAI } from "./ui.jsx";
import { fmtEGP, fmtEGPShort, fmtNum, fmtPct } from "../lib/format.js";
import { unitLabel } from "../lib/valuation.js";
import { parseBalances, localParseBalances, withTimeout } from "../lib/parse.js";
import { readAttachment, toAiInput } from "../lib/files.js";
import { CLASS_ORDER, ILLIQUID_CLASS, uid, touch, tombstone, live } from "../../shared/model.js";
import { CLASS_COLOR, CLASS_ICON, LIABILITY_COLOR, MONO_FONT, TEAL, ROSE } from "../theme.js";

/* ---------- one account ---------- */
function AccountRow({ a, onEdit, onDelete }) {
  const pl = !a.isLiability && a.cost > 0 ? a.egp - a.cost : null;
  return (
    <div className="flex items-center justify-between py-2 gap-2">
      <button onClick={() => onEdit(a)} className="text-left flex-1 min-w-0">
        <div className={"text-sm font-medium truncate " + (a.isLiability ? "mz-txrose" : "")}>{a.name}</div>
        <div className="text-[11px] font-mono mz-tx3 truncate">
          {a.unit === "GOLD" ? `${fmtNum(a.balance)} g · ${a.karat || 24}K` : a.unit === "USD" ? `$ ${fmtNum(a.balance)}` : "EGP"}
          {a.broker ? ` · ${a.broker}` : ""}
        </div>
      </button>
      <div className="flex items-center gap-1 shrink-0">
        <div className="text-right">
          <div className="font-mono tabular-nums text-sm" style={{ color: a.isLiability ? LIABILITY_COLOR : undefined }}>
            {fmtEGP(a.egp)}
          </div>
          {pl != null && (
            <div className="text-[10px] font-mono tabular-nums" style={{ color: pl >= 0 ? TEAL : ROSE }}>
              {(pl >= 0 ? "+" : "−") + Math.round(Math.abs(pl)).toLocaleString("en-US")} · {fmtPct((pl / a.cost) * 100)}
            </div>
          )}
          {a.isLiability && a.monthlyPayment > 0 && (
            <div className="text-[10px] font-mono mz-tx3">
              ~{Math.max(1, Math.ceil(Math.abs(a.egp) / a.monthlyPayment))} mo at {fmtEGPShort(a.monthlyPayment)}/mo
            </div>
          )}
        </div>
        <button onClick={() => onDelete(a)} aria-label={"Delete " + a.name} className="mz-iconbtn mz-tx3 mz-hovrose -mr-2">
          <Trash2 size={15} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

/* ---------- account form ---------- */
function AccountForm({ initial, onSave, onCancel }) {
  const [f, setF] = useState({ ...initial });
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const [err, setErr] = useState(null);

  function save() {
    if (!f.name || !f.name.trim()) { setErr("Give the account a name."); return; }
    onSave({ ...f, name: f.name.trim(), balance: Number(f.balance) || 0 });
  }

  return (
    <div className="space-y-2">
      <Field label="Name">
        <input className={inputCls} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. NBE savings" />
      </Field>
      <Field label="Asset class">
        <select className={inputCls} value={f.assetClass} onChange={(e) => set("assetClass", e.target.value)}>
          {CLASS_ORDER.map((c) => <option key={c}>{c}</option>)}
        </select>
      </Field>
      <Field label="Held in">
        <select className={inputCls} value={f.unit} onChange={(e) => set("unit", e.target.value)}>
          <option value="EGP">EGP</option>
          <option value="USD">US dollars</option>
          <option value="GOLD">Physical gold (grams)</option>
        </select>
      </Field>
      {f.unit === "GOLD" && (
        <Field label="Karat">
          <select className={inputCls} value={f.karat || 21} onChange={(e) => set("karat", Number(e.target.value))}>
            {[24, 21, 18, 14].map((k) => <option key={k} value={k}>{k}K</option>)}
          </select>
        </Field>
      )}
      <Field label={f.unit === "GOLD" ? "Weight (grams)" : f.unit === "USD" ? "Balance ($)" : "Balance (EGP)"}>
        <NumberInput value={f.balance} onChange={(v) => set("balance", v)} allowEmpty={false} />
      </Field>
      <Field label="Held at (broker, optional)">
        <input className={inputCls} value={f.broker || ""} onChange={(e) => set("broker", e.target.value)} placeholder="e.g. Thndr" />
      </Field>
      {!f.isLiability && ["Gold", "Equity", "Illiquid"].includes(f.assetClass) && (
        <Field label="Cost basis (EGP, optional)" hint="what you paid in total — drives the profit/loss line">
          <NumberInput value={f.cost ?? ""} onChange={(v) => set("cost", v === "" ? undefined : v)} placeholder="what you paid, total" />
        </Field>
      )}
      <label className="flex items-center gap-2 text-sm mz-tx2 pt-1">
        <input type="checkbox" checked={!!f.isLiability} onChange={(e) => set("isLiability", e.target.checked)} />
        This is a liability (debt / card balance)
      </label>
      {f.isLiability && (
        <Field label="Monthly payment (EGP, optional)">
          <NumberInput value={f.monthlyPayment ?? ""} onChange={(v) => set("monthlyPayment", v === "" ? undefined : v)} placeholder="installment per month" />
        </Field>
      )}
      {err && <div className="text-[11px] mz-txrose border mz-note-rose rounded-lg p-2">{err}</div>}
      <div className="flex gap-2 pt-2">
        <button onClick={save} className="flex-1 mz-btn-primary text-sm font-medium py-2 rounded-lg">Save</button>
        <button onClick={onCancel} className="px-4 text-sm mz-tx2">Cancel</button>
      </div>
    </div>
  );
}

/* ---------- bulk balance sync ---------- */
function BalanceSync({ accs, onApply }) {
  const toast = useToast();
  const callAI = useAI();
  const hasThndr = accs.some((a) => (a.broker || "").toLowerCase() === "thndr");
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState(hasThndr ? "thndr" : "all");
  const [draft, setDraft] = useState({});
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const fileRef = useRef(null);

  const targets = useMemo(
    () => (scope === "thndr" ? accs.filter((a) => (a.broker || "").toLowerCase() === "thndr") : accs.filter((a) => !a.isLiability)),
    [accs, scope]
  );

  useEffect(() => {
    const d = {};
    targets.forEach((a) => (d[a.id] = String(a.balance)));
    setDraft(d);
    setMsg(null);
    // targets is derived from open/scope; recomputing the draft on every accs
    // change would fight the user mid-edit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scope]);

  /* A screenshot of the app, or the PDF the broker emails every month —
     readAttachment decides whether the numbers can be read here or the file
     has to go up. */
  async function pickFile(file, cb) {
    if (!file) return;
    try {
      cb(await readAttachment(file));
    } catch {
      setMsg("Use a screenshot, a PDF statement, or type the balances.");
    }
  }

  function applyParsed(map) {
    setDraft((d) => {
      const nd = { ...d };
      Object.keys(map).forEach((id) => (nd[id] = String(map[id])));
      return nd;
    });
  }

  async function runParse(attachment) {
    setBusy(true);
    setMsg(null);
    try {
      const input = attachment ? toAiInput([attachment]) : {};
      const map = await withTimeout(parseBalances(targets, { text: text.trim(), ...input }, callAI), 30000);
      if (!Object.keys(map).length) throw new Error("empty");
      applyParsed(map);
      setMsg("Read " + Object.keys(map).length + " balance(s) — check, then Apply.");
    } catch {
      if (!attachment && text.trim()) {
        const map = localParseBalances(targets, text.trim());
        if (Object.keys(map).length) {
          applyParsed(map);
          setMsg("AI wasn't reachable; matched " + Object.keys(map).length + " offline — check, then Apply.");
        } else {
          setMsg("Couldn't match any balances. Type them like: clouds 338564, azg 45725, bwa 9762");
        }
      } else {
        setMsg("Reading a screenshot or PDF needs an AI provider — add a Gemini key in Settings. Type the balances instead.");
      }
    }
    setBusy(false);
  }

  function applyDraft() {
    const updates = {};
    targets.forEach((a) => {
      const v = Number(draft[a.id]);
      if (isFinite(v)) updates[a.id] = v;
    });
    onApply(updates);
    setOpen(false);
    toast("Updated " + Object.keys(updates).length + " balances");
  }

  return (
    <Card>
      <div className="flex items-center justify-between">
        <CardTitle>Update balances</CardTitle>
        <button onClick={() => setOpen((o) => !o)} className="text-xs font-mono px-3 py-1.5 rounded-lg mz-btn-primary">
          {open ? "close" : "sync"}
        </button>
      </div>
      {!open ? (
        <p className="text-[12px] mz-tx2 mt-1">Refresh balances in bulk from a screenshot (e.g. your Thndr portfolio), the PDF statement your broker emails, or by typing them — instead of editing each account by hand.</p>
      ) : (
        <div className="mt-3 space-y-3">
          {hasThndr && <Segmented options={[["thndr", "Thndr"], ["all", "All accounts"]]} value={scope} onChange={setScope} />}
          <div>
            <textarea
              rows={2}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="paste/type: clouds 338564, wallet 48520, azg 45725, bwa 9762"
              className="w-full mz-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 resize-none"
            />
            <div className="flex items-center gap-2 mt-2">
              <button onClick={() => fileRef.current && fileRef.current.click()} className="text-xs font-mono px-3 py-1.5 rounded-lg mz-btn-ghost inline-flex items-center gap-1.5">
                <Camera size={13} strokeWidth={2} /> screenshot or PDF
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,application/pdf,.pdf"
                className="hidden"
                onChange={(e) => pickFile(e.target.files && e.target.files[0], (att) => runParse(att))}
              />
              <button onClick={() => runParse(null)} disabled={busy} className="flex-1 text-sm font-medium px-3 py-2 rounded-lg mz-btn-primary">
                {busy ? "reading…" : "Read into fields"}
              </button>
            </div>
            {msg && <div className="mt-2 text-[11px] mz-tx2 border mz-note-mut rounded-lg p-2">{msg}</div>}
          </div>
          <div className="divide-y mz-dv max-h-72 overflow-auto">
            {targets.map((a) => (
              <div key={a.id} className="flex items-center justify-between py-2 gap-2">
                <span className="text-sm flex-1 truncate">
                  {a.name}
                  <span className="text-[11px] font-mono mz-tx3 ml-1">({unitLabel(a)})</span>
                </span>
                <NumberInput
                  className="w-32 font-mono text-right mz-input rounded-lg px-2 py-1 text-sm"
                  value={draft[a.id] ?? ""}
                  onChange={(v) => setDraft((d) => ({ ...d, [a.id]: v }))}
                />
              </div>
            ))}
          </div>
          <button onClick={applyDraft} className="w-full mz-btn-primary text-sm font-medium py-2 rounded-lg">Apply to {targets.length} accounts</button>
        </div>
      )}
    </Card>
  );
}

/* ---------- debts ---------- */
function DebtLedger({ debts, onAdd, onSettle }) {
  const [open, setOpen] = useState(false);
  const [dir, setDir] = useState("owed");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const receivable = debts.filter((d) => d.dir === "owed").reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const payable = debts.filter((d) => d.dir === "owe").reduce((s, d) => s + (Number(d.amount) || 0), 0);

  function add() {
    const amt = Number(amount) || 0;
    if (!amt) return;
    onAdd({
      id: uid(),
      dir,
      name: name.trim() || (dir === "owed" ? "Owed to me" : "I owe"),
      amount: amt,
      note: note.trim(),
      date: new Date().toISOString().slice(0, 10),
    });
    setName(""); setAmount(""); setNote("");
  }

  return (
    <Card>
      <div className="flex items-center justify-between">
        <CardTitle>Debts</CardTitle>
        <button onClick={() => setOpen((o) => !o)} className="text-xs font-mono px-3 py-1.5 rounded-lg mz-btn-primary">{open ? "close" : "log"}</button>
      </div>
      <div className="flex gap-5 mt-2 text-xs font-mono">
        <span className="mz-tx3">owed to me <span style={{ color: TEAL }}>{fmtEGP(receivable)}</span></span>
        <span className="mz-tx3">I owe <span style={{ color: ROSE }}>{fmtEGP(payable)}</span></span>
      </div>

      {open && (
        <div className="mt-3 space-y-2">
          <Segmented options={[["owed", "Owed to me"], ["owe", "I owe"]]} value={dir} onChange={setDir} />
          <div className="grid grid-cols-2 gap-2">
            <Field label="Counterparty"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ahmed" /></Field>
            <Field label="Amount (EGP)"><NumberInput value={amount} onChange={setAmount} /></Field>
          </div>
          <Field label="Note"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional — what it's for" /></Field>
          <button onClick={add} className="w-full mz-btn-primary text-sm font-medium py-2 rounded-lg">Add debt</button>
        </div>
      )}

      {debts.length > 0 && (
        <div className="divide-y mz-dv mt-3">
          {debts.map((d) => (
            <div key={d.id} className="flex items-center justify-between py-2 gap-2">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">
                  {d.name}
                  <span className="text-[10px] font-mono uppercase ml-2" style={{ color: d.dir === "owed" ? TEAL : ROSE }}>
                    {d.dir === "owed" ? "owed to me" : "I owe"}
                  </span>
                </div>
                <div className="text-[11px] font-mono mz-tx3 truncate">{d.date}{d.note ? " · " + d.note : ""}</div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <span className="font-mono tabular-nums text-sm" style={{ color: d.dir === "owed" ? TEAL : ROSE }}>{fmtEGP(d.amount)}</span>
                <button onClick={() => onSettle(d)} aria-label={"Settle " + d.name} className="mz-iconbtn mz-tx3 mz-txteal inline-flex items-center gap-1 -mr-2">
                  <Check size={15} strokeWidth={2.2} /><span className="text-[11px] font-mono">settle</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ---------- tab ---------- */
export default function Accounts({ valued, state, setState }) {
  const toast = useToast();
  const [editing, setEditing] = useState(null);

  const debts = live(state, "debts");

  function saveAccount(acc) {
    setState((s) => {
      const exists = s.accounts.some((a) => a.id === acc.id);
      const next = touch(acc);
      return { ...s, accounts: exists ? s.accounts.map((a) => (a.id === acc.id ? next : a)) : [...s.accounts, next] };
    });
    setEditing(null);
    toast("Saved · " + (acc.name || "account"));
  }

  /* Soft delete. A hard delete would look identical here but would be invisible
     to another device, which would push the account straight back on the next
     merge — and it would strand the transactions that reference it. */
  function removeAccount(a) {
    setState((s) => ({ ...s, accounts: s.accounts.map((x) => (x.id === a.id ? tombstone(x) : x)) }));
    toast("Deleted · " + a.name, {
      undo: () => setState((s) => ({
        ...s,
        accounts: s.accounts.map((x) => (x.id === a.id ? touch({ ...x, deletedAt: undefined }) : x)),
      })),
    });
  }

  function applyBalances(updates) {
    setState((s) => ({
      ...s,
      accounts: s.accounts.map((a) => (updates[a.id] != null ? touch({ ...a, balance: updates[a.id] }) : a)),
    }));
  }

  function addDebt(d) {
    setState((s) => ({ ...s, debts: [touch(d), ...(s.debts || [])] }));
    toast("Debt logged · " + d.name + " " + fmtEGPShort(d.amount));
  }

  function settleDebt(d) {
    setState((s) => ({ ...s, debts: (s.debts || []).map((x) => (x.id === d.id ? tombstone(x) : x)) }));
    toast("Settled · " + d.name + " " + fmtEGPShort(d.amount), {
      undo: () => setState((s) => ({
        ...s,
        debts: (s.debts || []).map((x) => (x.id === d.id ? touch({ ...x, deletedAt: undefined }) : x)),
      })),
    });
  }

  const grouped = {};
  CLASS_ORDER.forEach((c) => (grouped[c] = []));
  valued.forEach((a) => grouped[a.assetClass]?.push(a));

  return (
    <div className="space-y-3">
      <BalanceSync accs={valued} onApply={applyBalances} />
      <DebtLedger debts={debts} onAdd={addDebt} onSettle={settleDebt} />

      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setEditing({ id: uid(), name: "", assetClass: "Cash", unit: "EGP", balance: 0 })}
          className="text-sm font-medium py-2.5 rounded-xl border border-dashed mz-bd mz-tx2 mz-hovbd mz-hovi"
        >
          + Account
        </button>
        <button
          onClick={() => setEditing({ id: uid(), name: "", assetClass: "Illiquid", unit: "EGP", balance: 0 })}
          className="inline-flex items-center justify-center gap-1.5 text-sm font-medium py-2.5 rounded-xl border border-dashed hover:opacity-80 transition-opacity"
          style={{ borderColor: CLASS_COLOR.Illiquid + "80", color: CLASS_COLOR.Illiquid }}
        >
          <Building2 size={15} strokeWidth={2} /> Illiquid asset
        </button>
      </div>

      {editing && (
        <Modal title={state.accounts.some((a) => a.id === editing.id) ? "Edit account" : "New account"} onClose={() => setEditing(null)}>
          <AccountForm initial={editing} onSave={saveAccount} onCancel={() => setEditing(null)} />
        </Modal>
      )}

      {/* One well for the whole portfolio, not one card per class. The class
          is a 10px label and a dot inside it — five stacked cards made a
          portfolio look like five unrelated things, when the point of this
          screen is that they add up. */}
      <Card>
        {CLASS_ORDER.map((c, i) => {
          if (!grouped[c].length) return null;
          return (
            <div key={c} className={i > 0 ? "mt-4 pt-4 border-t mz-bd" : ""}>
              <div className="flex items-center gap-2 mb-1">
                <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: CLASS_COLOR[c] }} />
                <CardTitle>{c}</CardTitle>
                {c === ILLIQUID_CLASS && (
                  <span className="text-[11px] font-light mz-tx3 ml-auto">outside the ribbon</span>
                )}
              </div>
              <div className="divide-y mz-dv">
                {grouped[c].map((a) => <AccountRow key={a.id} a={a} onEdit={setEditing} onDelete={removeAccount} />)}
              </div>
            </div>
          );
        })}
      </Card>
    </div>
  );
}
