import mongoose from "mongoose";

const violationSchema = new mongoose.Schema(
  {
    session: { type: mongoose.Schema.Types.ObjectId, ref: "ParkingSession", required: true },
    video: { type: mongoose.Schema.Types.ObjectId, ref: "Video", required: true },
    zoneName: { type: String, required: true },
    vehicleType: { type: String, required: true },
    plate: { type: String, default: null },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, default: null }, // set once the vehicle actually leaves
    // durationSeconds/fine start as an estimate taken the moment the violation is
    // confirmed (for the immediate notification) and are finalized - to the real
    // total time parked - once the vehicle leaves. `finalized` tells the dashboard
    // which stage a record is at.
    durationSeconds: { type: Number, required: true },
    finalized: { type: Boolean, default: false },
    snapshotPath: { type: String, required: true }, // close-up at the violation moment
    entrySnapshotPath: { type: String, default: null }, // when it was first seen parked
    exitSnapshotPath: { type: String, default: null },  // when it left
    acknowledged: { type: Boolean, default: false },
    fine: { type: mongoose.Schema.Types.ObjectId, ref: "Fine" },
  },
  { timestamps: true }
);

export const Violation = mongoose.model("Violation", violationSchema);
