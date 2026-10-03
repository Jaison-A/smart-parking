import mongoose from "mongoose";

const videoSchema = new mongoose.Schema(
  {
    originalName: { type: String, required: true },
    // "upload": storedName is a filename on disk, uploads/videos/.
    // "stream": streamUrl is a live source - an rtsp(s)://, http(s):// camera URL,
    // or a bare webcam index ("0", "1", ...) - read directly, nothing is stored.
    sourceType: { type: String, enum: ["upload", "stream"], default: "upload" },
    storedName: String,
    streamUrl: String,
    sizeBytes: Number,
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
