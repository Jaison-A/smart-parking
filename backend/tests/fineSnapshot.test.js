import test from "node:test";
import assert from "node:assert/strict";
import { finalizeFineAmount } from "../src/services/fineService.js";

// A fine issued at 20/minute must be corrected at 20/minute on exit, even if an admin
// has since changed the settings - the driver was already shown that amount.
test("correcting a fine uses the rates it was issued with", async () => {
  let saved = false;
  const fine = {
    pricing: { baseAmount: 500, rate: 20, rateUnit: "minute", roundUp: true },
    amount: 500,
    save: async () => { saved = true; },
  };
  await finalizeFineAmount(fine, 30 + 10 * 60, "Gate");   // 10 minutes over the limit
  assert.equal(fine.amount, 500 + 10 * 20);
  assert.match(fine.reason, /"Gate"/);
  assert.equal(saved, true);
});
