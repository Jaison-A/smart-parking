import mongoose from "mongoose";

const fineSchema = new mongoose.Schema(
  {
    violation: { type: mongoose.Schema.Types.ObjectId, ref: "Violation", required: true, unique: true },
    plate: { type: String, default: null },
    amount: { type: Number, required: true },
    currency: { type: String, default: "INR" },
    status: { type: String, enum: ["issued", "paid", "cancelled"], default: "issued" },
    reason: { type: String, required: true },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    cancelReason: String,
  },
  { timestamps: true }
);

export const Fine = mongoose.model("Fine", fineSchema);
