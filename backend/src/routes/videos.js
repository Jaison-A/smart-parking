import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { v4 as uuid } from "uuid";
import { Video } from "../models/Video.js";
import { ParkingSession } from "../models/ParkingSession.js";
import { Violation } from "../models/Violation.js";
import { requireAuth } from "../middleware/auth.js";
import { stopDetectionJob, fetchFirstFrame } from "../services/detectorClient.js";
import { videoSource, VIDEO_DIR, launchJob } from "../services/jobStarter.js";
import { recordAudit } from "../services/auditService.js";
import { reconcileVideo, settleOrphanedJob } from "../services/jobReconciler.js";


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

// TEMPORARY test tool: upload a single picture and run it through the detector over
// and over until you click Stop, to check vehicle detection and plate reading.
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".bmp", ".webp"]);
const uploadImage = multer({
  storage: upload.storage, // same folder as videos, so the detector may read it
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!IMAGE_EXT.has(path.extname(file.originalname).toLowerCase())) {
      return cb(Object.assign(new Error("Unsupported image format (use jpg, png, bmp or webp)"), { status: 400 }));
    }
    cb(null, true);
  },
});

export const videosRouter = Router();
videosRouter.use(requireAuth);

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

// TEMPORARY test tool - see uploadImage above.
videosRouter.post("/image", uploadImage.single("image"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No image was uploaded (field name: image)" });
    const video = await Video.create({
      originalName: req.file.originalname,
      sourceType: "image",
      isTest: true, // a test picture: deletable in one click from Settings
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
    const videos = await Video.find().sort({ createdAt: -1 });
    // Only in-flight videos hit the detector, so this is usually zero or one call.
    await Promise.all(videos.map((v) => reconcileVideo(v)));
    res.json({ videos });
  } catch (err) { next(err); }
});

videosRouter.get("/:id", async (req, res, next) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video) return res.status(404).json({ error: "Video not found" });
    await reconcileVideo(video); // heal a "running" record whose job no longer exists
    res.json({ video });
  } catch (err) { next(err); }
});

// A still frame for the zone-drawing tool in the dashboard.
videosRouter.get("/:id/frame", async (req, res, next) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video) return res.status(404).json({ error: "Video not found" });
    const jpeg = await fetchFirstFrame(videoSource(video).path);
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
    await launchJob(video, { params: req.body?.params }); // 400s if no zone has been drawn
    res.json({ video });
  } catch (err) { next(err); }
});

videosRouter.post("/:id/stop", async (req, res, next) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video) return res.status(404).json({ error: "Video not found" });

    let jobGone = false;
    if (video.jobId) {
      try {
        await stopDetectionJob(video.jobId);
      } catch (err) {
        // The detector no longer knows this job (it restarted, or it already
        // finished). The job is gone either way, so stopping is complete - don't
        // surface that as an error, or the UI waits forever for a finish event.
        if (err.status !== 404) throw err;
        jobGone = true;
      }
    }

    if (jobGone) {
      // Nobody is left to close this job's open sessions, so do it here.
      await settleOrphanedJob(video, { status: "stopped" });
    } else if (["queued", "running"].includes(video.status)) {
      // Always settle the record here, so a stale "running" status can't outlive the job.
      video.status = "stopped";
      await video.save();
    }
    res.json({ stopping: true, video });
  } catch (err) { next(err); }
});

// Mark a video (and everything recorded from it) as test material, or take the mark off.
videosRouter.patch("/:id", async (req, res, next) => {
  try {
    const { isTest } = req.body ?? {};
    if (typeof isTest !== "boolean") return res.status(400).json({ error: "isTest must be true or false" });
    const video = await Video.findByIdAndUpdate(req.params.id, { isTest }, { new: true });
    if (!video) return res.status(404).json({ error: "Video not found" });
    await Violation.updateMany({ video: video._id }, { isTest });
    await recordAudit(req.user, "video.test-flag", { type: "video", id: String(video._id), label: video.originalName },
      [{ field: "isTest", from: !isTest, to: isTest }]);
    res.json({ video });
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
