import mongoose from "mongoose";

const videoSchema = new mongoose.Schema(
  {
    originalName: { type: String, required: true },
    storedName: { type: String, required: true }, // filename on disk, uploads/videos/
    sizeBytes: { type: Number, required: true },
    width: Number,
    height: Number,
    status: {
      type: String,
      enum: ["uploaded", "queued", "running", "completed", "failed", "stopped"],
      default: "uploaded",
    },
    progress: { type: Number, default: 0 },
    error: String,
    jobId: String,
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export const Video = mongoose.model("Video", videoSchema);
