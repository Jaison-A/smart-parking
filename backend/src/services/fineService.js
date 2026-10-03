import { Fine } from "../models/Fine.js";
import { env } from "../config/env.js";

/**
 * Fine amount = base + a surcharge for every extra 10 minutes over the threshold.
 * Kept as a pure function so it's easy to unit test and to explain in the report.
 */
export function calculateFineAmount(durationSeconds, thresholdSeconds = 30) {
  const overSeconds = Math.max(0, durationSeconds - thresholdSeconds);
  const extraTenMinBlocks = Math.ceil(overSeconds / 600);
  return env.fineBaseAmount + extraTenMinBlocks * env.finePerExtraMinute * 10;
}

export async function issueFineForViolation(violation) {
  const amount = calculateFineAmount(violation.durationSeconds);
  return Fine.create({
    violation: violation._id,
    plate: violation.plate,
    amount,
    reason: `Parked in "${violation.zoneName}" for ${Math.round(violation.durationSeconds)}s ` +
      `without a valid permit.`,
  });
}

// Called when the vehicle finally leaves: the fine was first issued using the
// duration at the threshold-crossing moment (so the notification is immediate),
// then corrected here to reflect the real total time parked.
export async function finalizeFineAmount(fine, finalDurationSeconds, zoneName) {
  fine.amount = calculateFineAmount(finalDurationSeconds);
  fine.reason = `Parked in "${zoneName}" for ${Math.round(finalDurationSeconds)}s total ` +
    `without a valid permit.`;
  await fine.save();
  return fine;
}
