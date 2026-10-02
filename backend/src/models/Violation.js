import mongoose from "mongoose";

const violationSchema = new mongoose.Schema(
  {
    session: { type: mongoose.Schema.Types.ObjectId, ref: "ParkingSession", required: true },
    video: { type: mongoose.Schema.Types.ObjectId, ref: "Video", required: true },
    zoneName: { type: String, required: true },
    vehicleType: { type: String, required: true },
    plate: { type: String, default: null },
    durationSeconds: { type: Number, required: true },
    snapshotPath: { type: String, required: true }, // uploads/snapshots/<file>.jpg
    acknowledged: { type: Boolean, default: false },
    fine: { type: mongoose.Schema.Types.ObjectId, ref: "Fine" },
  },
  { timestamps: true }
);

export const Violation = mongoose.model("Violation", violationSchema);
