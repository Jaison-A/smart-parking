import mongoose from "mongoose";

// Points are normalised (0..1) so one zone definition works at any video resolution.
const pointSchema = new mongoose.Schema(
  { x: { type: Number, required: true, min: 0, max: 1 },
    y: { type: Number, required: true, min: 0, max: 1 } },
  { _id: false }
);

const zoneSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ["parking", "no_parking"], required: true },
    points: { type: [pointSchema], validate: (v) => v.length >= 3 },
    video: { type: mongoose.Schema.Types.ObjectId, ref: "Video", required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export const Zone = mongoose.model("Zone", zoneSchema);
