/* Backup, restore and CSV export.

   The old backup was a textarea you had to select-all and copy by hand, which
   is exactly the step people skip right before they clear site data. These
   produce real files instead. */

import { outEgp, inEgp, sideName, sideUnitLabel } from "./valuation.js";
import { live } from "../../shared/model.js";

export function downloadFile(name, text, mime = "application/json") {
  const blob = new Blob([text], { type: mime + ";charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // give the browser a tick to start the download before revoking
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("read-failed"));
    r.readAsText(file);
  });
}

const stamp = () => new Date().toISOString().slice(0, 10);

export function backupPayload(state, prices) {
  return JSON.stringify({ v: 2, exported: new Date().toISOString(), state, prices }, null, 0);
}

export function exportBackupFile(state, prices) {
  downloadFile(`mizan-backup-${stamp()}.json`, backupPayload(state, prices));
}

/* RFC 4180: quote anything containing a delimiter, quote or newline, and
   double any embedded quotes. Excel and Numbers both read this correctly. */
function csvCell(v) {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const csvRows = (rows) => rows.map((r) => r.map(csvCell).join(",")).join("\r\n");

export function transactionsCsv(state, prices) {
  const accounts = state.accounts || [];
  const header = [
    "date", "type", "category", "subcategory", "note",
    "from_account", "amount_out", "out_unit",
    "to_account", "amount_in", "in_unit",
    "egp_out", "egp_in", "egp_net",
  ];
  const rows = live(state, "transactions")
    .slice()
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
    .map((t) => {
      const out = t.type === "income" ? 0 : outEgp(t, accounts, prices);
      const inc = t.type === "expense" ? 0 : inEgp(t, accounts, prices);
      return [
        t.date, t.type, t.category || "", t.subcategory || "", t.note || "",
        t.type === "income" ? "" : sideName(t, "from", accounts),
        t.type === "income" ? "" : t.fromAmount,
        t.type === "income" ? "" : sideUnitLabel(t, "from", accounts),
        t.type === "expense" ? "" : sideName(t, "to", accounts),
        t.type === "expense" ? "" : t.toAmount,
        t.type === "expense" ? "" : sideUnitLabel(t, "to", accounts),
        Math.round(out), Math.round(inc), Math.round(inc - out),
      ];
    });
  // BOM so Excel opens UTF-8 (Arabic notes) without mangling it
  return "﻿" + csvRows([header, ...rows]);
}

export function exportTransactionsCsv(state, prices) {
  downloadFile(`mizan-transactions-${stamp()}.csv`, transactionsCsv(state, prices), "text/csv");
}

export function accountsCsv(state, prices, egpValue) {
  const header = ["name", "class", "unit", "karat", "balance", "egp_value", "cost_basis", "is_liability", "broker"];
  const rows = live(state, "accounts").map((a) => [
    a.name, a.assetClass, a.unit, a.karat || "", a.balance,
    Math.round(egpValue(a, prices)), a.cost ?? "", a.isLiability ? "yes" : "no", a.broker || "",
  ]);
  return "﻿" + csvRows([header, ...rows]);
}

export function exportAccountsCsv(state, prices, egpValue) {
  downloadFile(`mizan-accounts-${stamp()}.csv`, accountsCsv(state, prices, egpValue), "text/csv");
}
