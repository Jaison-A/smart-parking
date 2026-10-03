import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import multer from "multer";
import { v4 as uuid } from "uuid";
import { Video } from "../models/Video.js";
import { Zone } from "../models/Zone.js";
import { ParkingSession } from "../models/ParkingSession.js";
import { Violation } from "../models/Violation.js";
import { requireAuth } from "../middleware/auth.js";
import { startDetectionJob, stopDetectionJob, fetchFirstFrame } from "../services/detectorClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIDEO_DIR = path.resolve(__dirname, "../../uploads/videos");

const ALLOWED_EXT = new Set([".mp4", ".mov", ".avi", ".mkv", ".webm"]);
const upload = multer({
  storage: multer.diskStorage({
    destination: VIDEO_DIR,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${uuid()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB - college-project sample videos
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_EXT.has(path.extname(file.originalname).toLowerCase())) {
      return cb(Object.assign(new Error("Unsupported video format"), { status: 400 }));
    }
    cb(null, true);
  },
});

export const videosRouter = Router();
videosRouter.use(requireAuth);

// What to hand the detector: a file path for an upload, or the raw URL/index for a
// live camera - the Python service's resolve_video_source() understands both.
function videoSource(video) {
  return video.sourceType === "stream" ? video.streamUrl : path.join(VIDEO_DIR, video.storedName);
}

const RTSP_OR_HTTP = /^(rtsps?|https?):\/\/.+/i;

// Upload a video to use in place of a live camera feed.
videosRouter.post("/", upload.single("video"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No video file was uploaded (field name: video)" });
    const video = await Video.create({
      originalName: req.file.originalname,
      sourceType: "upload",
      storedName: req.file.filename,
      sizeBytes: req.file.size,
      uploadedBy: req.user.sub,
    });
    res.status(201).json({ video });
  } catch (err) { next(err); }
});

// Connect a live camera instead of uploading a file: an RTSP/HTTP stream URL, or a
// bare webcam index ("0") for a camera plugged into the machine running the
// detection service. Everything downstream (zones, start/stop, live feed) is the
// same flow as an uploaded video.
videosRouter.post("/live", async (req, res, next) => {
  try {
    const { name, streamUrl } = req.body;
    if (!name || !streamUrl) return res.status(400).json({ error: "name and streamUrl are required" });
    if (!RTSP_OR_HTTP.test(streamUrl) && !/^\d+$/.test(streamUrl)) {
      return res.status(400).json({
        error: "streamUrl must be an rtsp:// or http(s):// camera URL, or a webcam index like \"0\"",
      });
    }
    const video = await Video.create({
      originalName: name, sourceType: "stream", streamUrl, uploadedBy: req.user.sub,
    });
    res.status(201).json({ video });
  } catch (err) { next(err); }
});

videosRouter.get("/", async (req, res, next) => {
  try {
    res.json({ videos: await Video.find().sort({ createdAt: -1 }) });
  } catch (err) { next(err); }
});

videosRouter.get("/:id", async (req, res, next) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video) return res.status(404).json({ error: "Video not found" });
    res.json({ video });
  } catch (err) { next(err); }
});

// A still frame for the zone-drawing tool in the dashboard.
videosRouter.get("/:id/frame", async (req, res, next) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video) return res.status(404).json({ error: "Video not found" });
    const jpeg = await fetchFirstFrame(videoSource(video));
    res.set("Content-Type", "image/jpeg").send(jpeg);
  } catch (err) { next(err); }
});

// Start detection: needs at least one zone already drawn for this video.
videosRouter.post("/:id/start", async (req, res, next) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video) return res.status(404).json({ error: "Video not found" });
    if (["queued", "running"].includes(video.status)) {
      return res.status(409).json({ error: "This video is already being processed" });
    }
    const zones = await Zone.find({ video: video._id });
    if (zones.length === 0) {
      return res.status(400).json({ error: "Draw at least one zone on this video before starting detection" });
    }

    const jobId = uuid();
    await startDetectionJob({
      jobId, videoId: video._id.toString(),
      videoPath: videoSource(video), zones,
      params: req.body?.params,
    });
    video.status = "queued";
    video.progress = 0;
    video.error = undefined;
    video.jobId = jobId;
    await video.save();
    res.json({ video });
  } catch (err) { next(err); }
});

videosRouter.post("/:id/stop", async (req, res, next) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video) return res.status(404).json({ error: "Video not found" });
    if (video.jobId) {
      try {
        await stopDetectionJob(video.jobId);
      } catch (err) {
        if (err.detectorStatus !== 404) throw err;
        video.status = "stopped";
        await video.save();
      }
    }
    res.json({ stopping: true });
  } catch (err) { next(err); }
});

videosRouter.get("/:id/sessions", async (req, res, next) => {
  try {
    const filter = { video: req.params.id };
    if (req.query.zoneType) filter.zoneType = req.query.zoneType;
    res.json({ sessions: await ParkingSession.find(filter).sort({ startedAt: -1 }) });
  } catch (err) { next(err); }
});

videosRouter.get("/:id/violations", async (req, res, next) => {
  try {
    res.json({
      violations: await Violation.find({ video: req.params.id })
        .populate("fine").sort({ createdAt: -1 }),
    });
  } catch (err) { next(err); }
});
