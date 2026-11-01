// Plate and phone normalisation - pure functions, no database.

/** "tn 09 ab-1234" -> "TN09AB1234" (the same form the detector reads plates in). */
export function normalisePlate(p) {
  return String(p ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const E164 = /^\+[1-9]\d{9,14}$/;

/**
 * Turns whatever a person typed into E.164 (+919876543210), or null if it can't be a
 * phone number. A number with no country code gets `defaultCountryCode`.
 */
export function normalisePhone(raw, defaultCountryCode = "+91") {
  let s = String(raw ?? "").trim().replace(/[\s\-().]/g, "");
  if (!s) return null;
  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (s.startsWith("+")) return E164.test(s) ? s : null;

  const cc = defaultCountryCode.startsWith("+") ? defaultCountryCode : `+${defaultCountryCode}`;
  const ccDigits = cc.slice(1);
  if (!/^\d+$/.test(s)) return null;
  // Already carries the country code, just without the "+" (e.g. 919876543210)
  if (s.startsWith(ccDigits) && s.length === ccDigits.length + 10) return E164.test(`+${s}`) ? `+${s}` : null;
  const full = cc + s.replace(/^0/, ""); // drop a leading trunk 0
  return E164.test(full) ? full : null;
}

/** +919876543210 -> +91******3210 (what the message log shows). */
export function maskPhone(phone) {
  const s = String(phone ?? "");
  if (s.length <= 7) return s;
  return s.slice(0, 3) + "*".repeat(s.length - 7) + s.slice(-4);
}
