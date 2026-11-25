/* Theme constants and icon maps — "Tide".

   Light/dark palettes live in CSS variables (see components/FontLoader.jsx):
   --bg, --card, --line, --ink, --muted, --faint, --sub, --sub2. The constants
   below are the theme-independent anchors — the values that have to be written
   into inline styles because they are chosen in JavaScript.

   That constraint is what shapes the palette. A class colour is picked in JS
   and cannot know the theme, so every one of them has to be legible on both
   the deep teal field and the pale one: mid-tone, moderate saturation, nothing
   that only works on a white card. The old palette was tuned for white cards
   and half of it disappeared into the dark ground.

   There is deliberately no brand accent. Tide carries meaning in three
   signals only — money in, money out, something to look at — and the ground
   itself is the identity. */

import {
  Landmark, Coins, TrendingUp, Banknote, Building2,
  UtensilsCrossed, Car, Home, Users, HeartPulse, ShoppingBag,
  ReceiptText, HandHeart, Sparkles, ArrowDownToLine, Tag,
} from "lucide-react";

export const ACCENT = "#3E93A8";    // the ground's own hue, for the few places JS needs one

/* The three signals. Money in, money out, look at this. */
export const TEAL = "#3FB49A";
export const ROSE = "#E2795F";
export const AMBER = "#D2A24E";

/* Mid-tone on purpose: each of these has to hold on the deep teal field and
   on the pale one, because the component picking it does not know which. */
export const CLASS_COLOR = {
  "Money market": "#58B4CE",
  Gold: "#D8AC4A",           // gold stays gold
  Equity: "#8A86D6",
  Cash: "#7E9AC2",
  Illiquid: "#A483D6",       // sits outside the ribbon
};
export const LIABILITY_COLOR = "#E08A72";

/* One family, weight as hierarchy — 200 for figures, 300 for prose, 500/600
   for the small caps labels. The "mono" role survives as a name because the
   whole app reaches for it, but in Tide it is Manrope with tabular figures:
   columns still line up, nothing looks like a terminal. */
export const DISPLAY_FONT = "'Manrope', ui-sans-serif, system-ui, sans-serif";
export const BODY_FONT = "'Manrope', ui-sans-serif, system-ui, sans-serif";
export const MONO_FONT = "'Manrope', ui-sans-serif, system-ui, sans-serif";

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
  Food: "#D8AC4A",
  Transport: "#58B4CE",
  Housing: "#8A86D6",
  Family: "#D683A8",
  Health: "#4FB8A8",
  Shopping: "#A483D6",
  Bills: "#7E9AC2",
  Investment: "#5FBF9B",
  Giving: "#63A9D6",
  Personal: "#E0966B",
  Income: "#3FB49A",
  Other: "#93A6AE",
};
const WHEEL = ["#D8AC4A", "#58B4CE", "#8A86D6", "#D683A8", "#4FB8A8", "#A483D6", "#7E9AC2", "#5FBF9B", "#63A9D6", "#E0966B"];

export function catColor(name) {
  if (CAT_COLOR[name]) return CAT_COLOR[name];
  const s = String(name || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return WHEEL[h % WHEEL.length];
}
