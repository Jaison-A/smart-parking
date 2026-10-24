// Pure fine arithmetic and settings validation - no database, so it can be tested
// and explained on its own.

export const RATE_UNITS = ["minute", "hour"];

/**
 * Fine = base amount + a charge for the time over the free limit.
 *
 *   rate unit "minute": rate is charged per minute over the limit
 *   rate unit "hour"  : rate is charged per hour over the limit
 *   roundUp true      : a started minute / hour counts as a whole one
 *                       (61 minutes at 60/hour -> 2 hours -> 120)
 *   roundUp false     : charged pro-rata, so 1/minute and 60/hour come out the same
 *
 * The result is rounded to whole rupees.
 */
export function calculateFineAmount(durationSeconds, thresholdSeconds, pricing) {
  const overSeconds = Math.max(0, durationSeconds - thresholdSeconds);
  const unitSeconds = pricing.rateUnit === "hour" ? 3600 : 60;
  const units = overSeconds / unitSeconds;
  const billedUnits = pricing.roundUp ? Math.ceil(units) : units;
  return Math.round(pricing.baseAmount + billedUnits * pricing.rate);
}

const MAX_AMOUNT = 1_000_000;

function amount(input, label) {
  const n = typeof input === "string" && input.trim() === "" ? NaN : Number(input);
  if (!Number.isFinite(n) || n < 0 || n > MAX_AMOUNT) {
    throw Object.assign(new Error(`${label} must be a number between 0 and ${MAX_AMOUNT}`), { status: 400 });
  }
  return n;
}

/** Checks what an admin submitted and returns clean values, or throws a 400. */
export function validateFineSettings(input = {}) {
  const rateUnit = input.rateUnit;
  if (!RATE_UNITS.includes(rateUnit)) {
    throw Object.assign(new Error("Rate unit must be \"minute\" or \"hour\""), { status: 400 });
  }
  if (typeof input.roundUp !== "boolean") {
    throw Object.assign(new Error("roundUp must be true or false"), { status: 400 });
  }
  return {
    baseAmount: amount(input.baseAmount, "Base fine"),
    rate: amount(input.rate, "Rate"),
    rateUnit,
    roundUp: input.roundUp,
    ruleAmount: amount(input.ruleAmount, "Rule-violation fine"),
  };
}
