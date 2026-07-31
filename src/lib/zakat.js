/* Zakat: nisab test, hawl clock, and the amount due.

   Two things the old card got wrong. It only knew the gold nisab (85g), which
   in today's prices is by far the more lenient threshold — most guidance for
   mixed cash-and-gold wealth is to use the silver nisab (595g), which is much
   lower and therefore catches you sooner. And it had no hawl: zakat is owed on
   wealth that stayed above nisab for a full lunar year, so a figure with no
   clock behind it is a number, not a reminder.

   This is still an estimate, not a ruling. Intent, business inventory,
   debt treatment and the choice of standard are all matters the user should
   settle with someone qualified — the card says so. */

import { NISAB_GRAMS } from "../../shared/model.js";
import { LUNAR_YEAR_DAYS, addDays } from "./format.js";
import { karatPrice } from "./valuation.js";

/* EGP value of the nisab under the chosen standard. Silver needs a silver
   price; when we don't have one the caller is told so rather than being shown
   a silently wrong threshold. */
export function nisabEgp(standard, prices) {
  if (standard === "silver") {
    const silver = Number(prices && prices.silver) || 0;
    if (!silver) return { value: 0, unavailable: true, grams: NISAB_GRAMS.silver, metal: "silver" };
    return { value: NISAB_GRAMS.silver * silver, grams: NISAB_GRAMS.silver, metal: "silver" };
  }
  return { value: NISAB_GRAMS.gold * karatPrice(prices, 24), grams: NISAB_GRAMS.gold, metal: "gold" };
}

/* The base zakat is charged on. Illiquid property held for use (a home, a car)
   is normally exempt; property held to resell is not — hence the toggle. */
export function zakatBase({ liquidTotal, illiquidTotal, liabilities, includeIlliquid }) {
  const gross = liquidTotal + (includeIlliquid ? illiquidTotal : 0);
  return Math.max(0, gross - liabilities);
}

export function zakatStatus({ zakat, liquidTotal, illiquidTotal, liabilities, prices, today }) {
  const cfg = zakat || {};
  const standard = cfg.standard === "gold" ? "gold" : "silver";
  const nisab = nisabEgp(standard, prices);
  const base = zakatBase({
    liquidTotal,
    illiquidTotal,
    liabilities,
    includeIlliquid: !!cfg.includeIlliquid,
  });

  // when the silver price is missing we fall back to gold rather than claiming
  // everyone is below an unknown threshold
  const effective = nisab.unavailable ? nisabEgp("gold", prices) : nisab;
  const above = effective.value > 0 && base >= effective.value;

  const start = cfg.hawlStart || null;
  const dueDate = start ? addDays(start, LUNAR_YEAR_DAYS) : null;
  const daysHeld = start ? Math.floor((new Date(today) - new Date(start)) / 86400000) : 0;
  const daysLeft = start ? LUNAR_YEAR_DAYS - daysHeld : null;
  const hawlComplete = !!(above && start && daysHeld >= LUNAR_YEAR_DAYS);

  return {
    standard,
    nisab: effective,
    silverUnavailable: !!nisab.unavailable && standard === "silver",
    base,
    above,
    hawlStart: start,
    dueDate,
    daysHeld,
    daysLeft,
    hawlComplete,
    progress: start ? Math.min(1, Math.max(0, daysHeld / LUNAR_YEAR_DAYS)) : 0,
    due: above ? base * 0.025 : 0,
  };
}

/* What the stored hawlStart should become, given today's standing.
   Returns undefined when nothing needs to change, so the caller can skip the
   write and avoid a render loop. */
export function nextHawlStart(status, today) {
  if (status.above && !status.hawlStart) return today;   // crossed nisab: start the clock
  if (!status.above && status.hawlStart) return null;    // fell below: the year resets
  return undefined;
}
