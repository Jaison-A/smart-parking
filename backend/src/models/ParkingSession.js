import mongoose from "mongoose";

// One row per (vehicle, zone-visit) - covers legal parking AND no-parking violations,
// per the project requirement to log duration and plate in both cases.
const sessionSchema = new mongoose.Schema(
  {
    sessionKey: { type: String, required: true, unique: true }, // id from the detector
    video: { type: mongoose.Schema.Types.ObjectId, ref: "Video", required: true },
    trackId: { type: Number, required: true },
    zone: { type: mongoose.Schema.Types.ObjectId, ref: "Zone" },
    zoneName: String,
    zoneType: { type: String, enum: ["parking", "no_parking"], required: true },
    vehicleType: { type: String, enum: ["car", "motorcycle", "bus", "truck"], required: true },
    plate: { type: String, default: null },
    plateConfidence: { type: Number, default: null },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, default: null },
    durationSeconds: { type: Number, default: 0 },
    isViolation: { type: Boolean, default: false },
    status: { type: String, enum: ["active", "closed"], default: "active" },
  },
  { timestamps: true }
);

sessionSchema.index({ video: 1, status: 1 });
sessionSchema.index({ plate: 1 });

export const ParkingSession = mongoose.model("ParkingSession", sessionSchema);
