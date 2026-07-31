import { test } from "node:test";
import assert from "node:assert/strict";
import { nisabEgp, zakatBase, zakatStatus, nextHawlStart } from "../src/lib/zakat.js";
import { addDays } from "../src/lib/format.js";

const prices = { gold24: 6000, usdEgp: 50, silver: 70 };

test("nisab thresholds", () => {
  assert.equal(nisabEgp("gold", prices).value, 85 * 6000);
  assert.equal(nisabEgp("silver", prices).value, 595 * 70);
  assert.ok(nisabEgp("silver", prices).value < nisabEgp("gold", prices).value, "silver is the lower bar — that is why it is the default");
});

test("a missing silver price is reported, not silently wrong", () => {
  const n = nisabEgp("silver", { gold24: 6000 });
  assert.equal(n.unavailable, true);
  const st = zakatStatus({ zakat: { standard: "silver" }, liquidTotal: 1e6, illiquidTotal: 0, liabilities: 0, prices: { gold24: 6000 }, today: "2026-07-31" });
  assert.equal(st.silverUnavailable, true);
  assert.equal(st.nisab.metal, "gold", "falls back to gold rather than an unknown threshold");
});

test("base subtracts liabilities and excludes illiquid by default", () => {
  assert.equal(zakatBase({ liquidTotal: 100, illiquidTotal: 500, liabilities: 30, includeIlliquid: false }), 70);
  assert.equal(zakatBase({ liquidTotal: 100, illiquidTotal: 500, liabilities: 30, includeIlliquid: true }), 570);
  assert.equal(zakatBase({ liquidTotal: 10, illiquidTotal: 0, liabilities: 999, includeIlliquid: false }), 0, "never negative");
});

test("due is 2.5% only once above nisab", () => {
  const below = zakatStatus({ zakat: {}, liquidTotal: 1000, illiquidTotal: 0, liabilities: 0, prices, today: "2026-07-31" });
  assert.equal(below.above, false);
  assert.equal(below.due, 0);

  const above = zakatStatus({ zakat: {}, liquidTotal: 200000, illiquidTotal: 0, liabilities: 0, prices, today: "2026-07-31" });
  assert.equal(above.above, true);
  assert.equal(above.due, 200000 * 0.025);
});

test("the hawl completes after a lunar year, not a solar one", () => {
  const start = "2026-01-01";
  const args = { zakat: { hawlStart: start }, liquidTotal: 200000, illiquidTotal: 0, liabilities: 0, prices };

  const day353 = zakatStatus({ ...args, today: addDays(start, 353) });
  assert.equal(day353.hawlComplete, false);
  assert.equal(day353.daysLeft, 1);

  const day354 = zakatStatus({ ...args, today: addDays(start, 354) });
  assert.equal(day354.hawlComplete, true);
});

test("crossing nisab starts the clock and dropping below resets it", () => {
  const today = "2026-07-31";
  const crossed = zakatStatus({ zakat: {}, liquidTotal: 200000, illiquidTotal: 0, liabilities: 0, prices, today });
  assert.equal(nextHawlStart(crossed, today), today);

  const running = zakatStatus({ zakat: { hawlStart: "2026-01-01" }, liquidTotal: 200000, illiquidTotal: 0, liabilities: 0, prices, today });
  assert.equal(nextHawlStart(running, today), undefined, "no write, so no render loop");

  const fell = zakatStatus({ zakat: { hawlStart: "2026-01-01" }, liquidTotal: 10, illiquidTotal: 0, liabilities: 0, prices, today });
  assert.equal(nextHawlStart(fell, today), null);
});
