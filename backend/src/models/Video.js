import mongoose from "mongoose";

const videoSchema = new mongoose.Schema(
  {
    originalName: { type: String, required: true },
    // "upload": storedName is a filename on disk, uploads/videos/.
    // "stream": streamUrl is a live source - an rtsp(s)://, http(s):// camera URL,
    // or a bare webcam index ("0", "1", ...) - read directly, nothing is stored.
    sourceType: { type: String, enum: ["upload", "stream", "image"], default: "upload" },
    storedName: String,
    streamUrl: String,
    sizeBytes: Number,
    width: Number,
    height: Number,
    status: {
      type: String,
      enum: ["uploaded", "queued", "running", "paused", "completed", "failed", "stopped"],
      default: "uploaded",
    },
    progress: { type: Number, default: 0 },
    error: String,
    jobId: String,
    // Test material (e.g. the temporary test image): flagged so it can be told apart from
    // real records and wiped in one click from Settings.
    isTest: { type: Boolean, default: false },
    // Where the running job had got to, saved every few seconds by the detector so a
    // restarted detector can resume from here (see services/jobReconciler.js). Not
    // returned by default - it can be large and the dashboard never needs it.
    checkpoint: { type: mongoose.Schema.Types.Mixed, select: false },
    resumeCount: { type: Number, default: 0 }, // automatic resumes of the current run (capped)
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export const Video = mongoose.model("Video", videoSchema);
