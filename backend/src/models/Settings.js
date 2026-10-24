import mongoose from "mongoose";

// One document holds the admin-editable settings. Anything not saved yet falls back to
// the .env defaults (see services/settingsService.js).
const settingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: "global", unique: true },
    baseAmount: Number,
    rate: Number,
    rateUnit: { type: String, enum: ["minute", "hour"] },
    roundUp: Boolean,
    ruleAmount: Number,
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export const Settings = mongoose.model("Settings", settingsSchema);
