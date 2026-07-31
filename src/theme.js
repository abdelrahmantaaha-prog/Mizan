/* Theme constants and icon maps.

   Light/dark palettes live in CSS variables (see components/FontLoader.jsx):
   --bg, --card, --line, --ink, --muted, --faint, --sub, --sub2. The constants
   below are the theme-independent anchors: the hero card is always dark navy,
   and an asset class keeps its colour in both themes so the ribbon, the donut
   and the legend always agree. */

import {
  Landmark, Coins, TrendingUp, Banknote, Building2,
  UtensilsCrossed, Car, Home, Users, HeartPulse, ShoppingBag,
  ReceiptText, HandHeart, Sparkles, ArrowDownToLine, Tag,
} from "lucide-react";

// theme: "Deep water." Midnight-navy ink, electric blue accent.
export const INK = "#0C1730";       // midnight navy (hero card bg, toasts)
export const INK_2 = "#152341";     // panel navy, one step lighter
export const HAIRLINE = "#233458";  // border on dark panels
export const ACCENT = "#3B7DFF";    // electric blue accent
export const ACCENT_DIM = "#2563EB";
export const MUTED_ON_DARK = "#8FA0BF";

export const TEAL = "#0d9488";
export const ROSE = "#e11d48";
export const AMBER = "#d97706";

export const CLASS_COLOR = {
  "Money market": "#22B8CF", // cyan
  Gold: "#F2A93B",           // amber — gold stays gold
  Equity: "#6366F1",         // indigo
  Cash: "#5B7CC4",           // steel blue
  Illiquid: "#8B5CF6",       // violet (sits outside the ribbon)
};
export const LIABILITY_COLOR = "#F4506B"; // coral-red

export const DISPLAY_FONT = "'Space Grotesk', ui-sans-serif, system-ui, sans-serif";
export const BODY_FONT = "'Inter', ui-sans-serif, system-ui, sans-serif";
export const MONO_FONT = "'JetBrains Mono', ui-monospace, 'SF Mono', monospace";

export const CLASS_ICON = {
  "Money market": Landmark,
  Gold: Coins,
  Equity: TrendingUp,
  Cash: Banknote,
  Illiquid: Building2,
};

export const CAT_ICON = {
  Food: UtensilsCrossed,
  Transport: Car,
  Housing: Home,
  Family: Users,
  Health: HeartPulse,
  Shopping: ShoppingBag,
  Bills: ReceiptText,
  Investment: TrendingUp,
  Giving: HandHeart,
  Personal: Sparkles,
  Income: ArrowDownToLine,
  Other: Tag,
};
export const catIcon = (name) => CAT_ICON[name] || Tag;

/* Spending categories used to render as identical blue bars, which made a
   breakdown impossible to read at a glance. Each known category now owns a
   hue; anything user-invented is hashed into the same wheel so it stays
   stable across sessions instead of shuffling on every render. */
const CAT_COLOR = {
  Food: "#F2A93B",
  Transport: "#22B8CF",
  Housing: "#6366F1",
  Family: "#EC4899",
  Health: "#14B8A6",
  Shopping: "#8B5CF6",
  Bills: "#5B7CC4",
  Investment: "#10B981",
  Giving: "#0EA5E9",
  Personal: "#F97316",
  Income: "#0d9488",
  Other: "#94A3B8",
};
const WHEEL = ["#F2A93B", "#22B8CF", "#6366F1", "#EC4899", "#14B8A6", "#8B5CF6", "#5B7CC4", "#10B981", "#0EA5E9", "#F97316"];

export function catColor(name) {
  if (CAT_COLOR[name]) return CAT_COLOR[name];
  const s = String(name || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return WHEEL[h % WHEEL.length];
}
