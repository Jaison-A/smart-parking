import mongoose from "mongoose";

// Every attempt to tell an owner about a fine - including the ones that were skipped
// (and why), so "was the owner told?" always has an answer.
const logSchema = new mongoose.Schema(
  {
    violation: { type: mongoose.Schema.Types.ObjectId, ref: "Violation", index: true },
    fine: { type: mongoose.Schema.Types.ObjectId, ref: "Fine" },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "Owner" },
    plate: String,
    channel: { type: String, enum: ["sms", "whatsapp", "none"], default: "none" },
    to: String,       // masked, e.g. +91******3210 - the full number stays on the owner record
    body: String,
    provider: String, // mock | twilio
    // sent = delivered to the provider, mock = recorded only (demo), failed = provider error,
    // skipped = nobody to tell (see `error` for the reason)
    status: { type: String, enum: ["sent", "mock", "failed", "skipped"], required: true },
    error: String,
    providerId: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const NotificationLog = mongoose.model("NotificationLog", logSchema);
