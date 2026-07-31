/* Recurring transactions — rent, salary, subscriptions.

   Deliberately not automatic. The app proposes what is due and you confirm;
   silently writing money movements you never saw would make the balances
   untrustworthy, which is the one thing a net-worth tracker cannot afford.
   A rule that has been ignored for months proposes each missed occurrence
   once, capped, rather than dumping a year of back-dated rows. */

import { addDays, addMonths } from "./format.js";
import { uid } from "../../shared/model.js";

export const FREQUENCIES = [
  ["weekly", "Weekly"],
  ["biweekly", "Every 2 weeks"],
  ["monthly", "Monthly"],
  ["quarterly", "Every 3 months"],
  ["yearly", "Yearly"],
];

const MAX_CATCH_UP = 12;

export function advance(date, freq) {
  switch (freq) {
    case "weekly": return addDays(date, 7);
    case "biweekly": return addDays(date, 14);
    case "quarterly": return addMonths(date, 3);
    case "yearly": return addMonths(date, 12);
    case "monthly":
    default: return addMonths(date, 1);
  }
}

export function newRule(template = {}) {
  return {
    id: uid(),
    label: template.label || "",
    freq: template.freq || "monthly",
    nextDate: template.nextDate || new Date().toISOString().slice(0, 10),
    type: template.type || "expense",
    fromId: template.fromId || null,
    toId: template.toId || null,
    fromAmount: Number(template.fromAmount) || 0,
    toAmount: template.toAmount != null ? Number(template.toAmount) : undefined,
    category: template.category || "",
    subcategory: template.subcategory || "",
    note: template.note || "",
    paused: false,
    updatedAt: Date.now(),
  };
}

/* Every occurrence a rule owes as of `today`, oldest first. */
export function dueOccurrences(rule, today) {
  if (!rule || rule.paused || rule.deletedAt) return [];
  const out = [];
  let d = rule.nextDate;
  let guard = 0;
  while (d && d <= today && guard < MAX_CATCH_UP) {
    out.push({ ruleId: rule.id, date: d, rule });
    d = advance(d, rule.freq);
    guard++;
  }
  return out;
}

export function allDue(rules, today) {
  return (rules || [])
    .flatMap((r) => dueOccurrences(r, today))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/* Where the rule's clock lands once an occurrence dated `date` is handled —
   whether it was logged or skipped. */
export function afterOccurrence(rule, date) {
  return advance(date, rule.freq);
}

export function occurrenceToTxn(occ) {
  const r = occ.rule;
  return {
    type: r.type,
    fromId: r.type === "income" ? null : r.fromId,
    toId: r.type === "expense" ? null : r.toId,
    fromAmount: r.fromAmount,
    toAmount: r.toAmount,
    category: r.category,
    subcategory: r.subcategory,
    note: r.note || r.label,
    date: occ.date,
  };
}
