import mongoose from "mongoose";

// The rates this fine was priced with, kept on the fine itself: a fine is issued when the
// vehicle crosses the limit and corrected when it leaves, and changing the settings in
// between must not change what the driver was shown.
const pricingSchema = new mongoose.Schema(
  { baseAmount: Number, rate: Number, rateUnit: String, roundUp: Boolean },
  { _id: false }
);

const fineSchema = new mongoose.Schema(
  {
    violation: { type: mongoose.Schema.Types.ObjectId, ref: "Violation", required: true, unique: true },
    plate: { type: String, default: null },
    amount: { type: Number, required: true },
    currency: { type: String, default: "INR" },
    status: { type: String, enum: ["issued", "paid", "cancelled"], default: "issued" },
    reason: { type: String, required: true },
    pricing: { type: pricingSchema, default: undefined }, // absent on fines issued before this existed
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    cancelReason: String,
  },
  { timestamps: true }
);

export const Fine = mongoose.model("Fine", fineSchema);
