import mongoose from "mongoose";

// A registered vehicle owner who has agreed to be contacted about parking violations.
// Nothing is looked up from government records - owners are added here with consent.
const ownerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true }, // E.164, e.g. +919876543210
    plates: {
      type: [String], // normalised: upper case, letters and digits only
      validate: { validator: (v) => v.length >= 1, message: "At least one plate is required" },
    },
    channels: {
      sms: { type: Boolean, default: true },
      whatsapp: { type: Boolean, default: false },
    },
    consent: {
      given: { type: Boolean, required: true, validate: { validator: (v) => v === true, message: "Consent is required" } },
      at: { type: Date, default: Date.now },
      note: { type: String, default: "" }, // how consent was given, e.g. "signed form 2026-10-20"
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);
// A plate belongs to exactly one owner.
ownerSchema.index({ plates: 1 }, { unique: true });

export const Owner = mongoose.model("Owner", ownerSchema);
