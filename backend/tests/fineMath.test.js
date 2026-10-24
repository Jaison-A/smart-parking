import test from "node:test";
import assert from "node:assert/strict";
import { calculateFineAmount as fine, validateFineSettings } from "../src/services/fineMath.js";

const T = 30; // free limit, seconds
const P = (over = {}) => ({ baseAmount: 500, rate: 20, rateUnit: "minute", roundUp: true, ...over });

test("at or under the limit only the base fine applies", () => {
  assert.equal(fine(30, T, P()), 500);
  assert.equal(fine(10, T, P()), 500);
});

test("per minute, a started minute counts as a whole one", () => {
  assert.equal(fine(30 + 60, T, P()), 520);     // exactly 1 min over
  assert.equal(fine(30 + 61, T, P()), 540);     // 1 min 1 s over -> 2 minutes
});

test("per hour with round-up: 61 minutes over is billed as 2 hours", () => {
  assert.equal(fine(30 + 61 * 60, T, P({ rate: 60, rateUnit: "hour" })), 500 + 120);
});

test("per minute 1 and per hour 60 are the SAME when charged pro-rata", () => {
  for (const mins of [1, 10, 61, 90, 125]) {
    const d = 30 + mins * 60;
    const perMinute = fine(d, T, P({ rate: 1, rateUnit: "minute", roundUp: false }));
    const perHour = fine(d, T, P({ rate: 60, rateUnit: "hour", roundUp: false }));
    assert.equal(perMinute, perHour, `${mins} min`);
    assert.equal(perMinute, 500 + mins);
  }
});

test("...but differ when the hourly rate rounds up (this is the real difference)", () => {
  const d = 30 + 61 * 60;
  assert.equal(fine(d, T, P({ rate: 1, rateUnit: "minute", roundUp: true })), 561);
  assert.equal(fine(d, T, P({ rate: 60, rateUnit: "hour", roundUp: true })), 620);
});

test("the result is whole rupees", () => {
  assert.equal(Number.isInteger(fine(30 + 100, T, P({ rate: 7, rateUnit: "hour", roundUp: false }))), true);
});

const ok = { baseAmount: 500, rate: 20, rateUnit: "minute", roundUp: true, ruleAmount: 200 };

test("valid settings are accepted and returned clean", () => {
  assert.deepEqual(validateFineSettings({ ...ok, baseAmount: "750" }), { ...ok, baseAmount: 750 });
});

test("bad settings are rejected with a 400", () => {
  const bad = [
    { ...ok, baseAmount: -1 }, { ...ok, rate: "abc" }, { ...ok, ruleAmount: "" },
    { ...ok, baseAmount: 1e9 }, { ...ok, rateUnit: "day" }, { ...ok, roundUp: "yes" },
    { ...ok, rate: undefined },
  ];
  for (const input of bad) {
    assert.throws(() => validateFineSettings(input), (e) => e.status === 400, JSON.stringify(input));
  }
});
