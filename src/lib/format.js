/* Number, money and date formatting. Everything the app prints goes through
   here so a figure looks the same in a card, a chart tooltip and a CSV. */

const safe = (n) => (isFinite(n) ? Number(n) : 0);

export const fmtEGP = (n) => {
  const v = safe(n);
  return (v < 0 ? "−" : "") + "EGP " + Math.round(Math.abs(v)).toLocaleString("en-US");
};

/* compact form for tight layouts (hero stat columns): 3,412,000 → "EGP 3.41M" */
export const fmtEGPShort = (n) => {
  const v = safe(n);
  const a = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (a >= 1e9) return sign + "EGP " + (a / 1e9).toFixed(2).replace(/\.?0+$/, "") + "B";
  if (a >= 1e6) return sign + "EGP " + (a / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.?0+$/, "") + "M";
  if (a >= 1e4) return sign + "EGP " + Math.round(a / 1e3) + "k";
  return sign + "EGP " + Math.round(a).toLocaleString("en-US");
};

/* bare number, no currency — for chart axes and grams */
export const fmtNum = (n, d = 2) =>
  safe(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: d });

export const fmtPct = (n) => (safe(n) >= 0 ? "+" : "−") + Math.abs(safe(n)).toFixed(1) + "%";

export const timeAgo = (ts) => {
  if (!ts) return "never";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 0) return "just now";
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
};

export function monthLabel(m) {
  try {
    const d = new Date(m + "-01");
    if (isNaN(d.getTime())) return m;
    return d.toLocaleString("en", { month: "short" }) + " " + String(d.getFullYear()).slice(2);
  } catch {
    return m;
  }
}

export function dayLabel(d) {
  try {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return d;
    return dt.toLocaleString("en", { day: "numeric", month: "short" });
  } catch {
    return d;
  }
}

/* "Today" / "Yesterday" / "12 Mar" — used as date group headers in Activity */
export function relativeDay(d) {
  const t = new Date().toISOString().slice(0, 10);
  if (d === t) return "Today";
  const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (d === y) return "Yesterday";
  return dayLabel(d);
}

export const addDays = (iso, n) => new Date(new Date(iso + "T00:00:00Z").getTime() + n * 86400000).toISOString().slice(0, 10);

export function addMonths(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  // clamp: 31 Jan + 1 month lands on 28/29 Feb, not 3 March
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.toISOString().slice(0, 10);
}

/* Islamic (lunar) year for the zakat hawl — 354 days is the conventional
   approximation and is what the reminder is judged against. */
export const LUNAR_YEAR_DAYS = 354;
