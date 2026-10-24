import { Fine } from "../models/Fine.js";
import { getFineSettings } from "./settingsService.js";
import { calculateFineAmount } from "./fineMath.js";

export { calculateFineAmount };

const THRESHOLD_SECONDS = 30;

export async function issueFineForViolation(violation) {
  const settings = await getFineSettings();

  // Spacing / bay violations: a flat fine, with the specific reason as the reason.
  if (violation.kind !== "no_parking") {
    return Fine.create({
      violation: violation._id,
      plate: violation.plate,
      amount: settings.ruleAmount,
      reason: `${violation.detail || "Parking rule broken"} in "${violation.zoneName}".`,
    });
  }
  const pricing = {
    baseAmount: settings.baseAmount, rate: settings.rate,
    rateUnit: settings.rateUnit, roundUp: settings.roundUp,
  };
  return Fine.create({
    violation: violation._id,
    plate: violation.plate,
    amount: calculateFineAmount(violation.durationSeconds, THRESHOLD_SECONDS, pricing),
    pricing,
    reason: `Parked in "${violation.zoneName}" for ${Math.round(violation.durationSeconds)}s ` +
      `without a valid permit.`,
  });
}

// Called when the vehicle finally leaves: the fine was first issued using the
// duration at the threshold-crossing moment (so the notification is immediate),
// then corrected here to reflect the real total time parked - at the rates it was
// ISSUED with, not whatever the settings say now.
export async function finalizeFineAmount(fine, finalDurationSeconds, zoneName) {
  const pricing = fine.pricing?.rateUnit ? fine.pricing.toObject?.() ?? fine.pricing : await getFineSettings();
  fine.amount = calculateFineAmount(finalDurationSeconds, THRESHOLD_SECONDS, pricing);
  fine.reason = `Parked in "${zoneName}" for ${Math.round(finalDurationSeconds)}s total ` +
    `without a valid permit.`;
  await fine.save();
  return fine;
}
