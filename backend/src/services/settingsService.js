import { Settings } from "../models/Settings.js";
import { env } from "../config/env.js";
import { validateFineSettings } from "./fineMath.js";

export const SETTING_FIELDS = ["baseAmount", "rate", "rateUnit", "roundUp", "ruleAmount", "bayRulesEnabled"];
const FIELDS = SETTING_FIELDS;

// Used until an admin saves their own values.
export const envDefaults = () => ({
  baseAmount: env.fineBaseAmount,
  rate: env.finePerExtraMinute,
  rateUnit: "minute",
  roundUp: true,
  ruleAmount: env.fineRuleAmount,
  bayRulesEnabled: true,
});

export async function getFineSettings() {
  const doc = await Settings.findOne({ key: "global" }).lean();
  const saved = {};
  for (const f of FIELDS) if (doc?.[f] !== undefined && doc?.[f] !== null) saved[f] = doc[f];
  return { ...envDefaults(), ...saved };
}

export async function saveFineSettings(input, userId) {
  const clean = validateFineSettings(input);
  await Settings.findOneAndUpdate(
    { key: "global" },
    { ...clean, updatedBy: userId },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return getFineSettings();
}
