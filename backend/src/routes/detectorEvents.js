import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import { Video } from "../models/Video.js";
import { ParkingSession } from "../models/ParkingSession.js";
import { Violation } from "../models/Violation.js";
import { requireDetectorKey } from "../middleware/detectorAuth.js";
import { issueFineForViolation } from "../services/fineService.js";
import { notifyControllers } from "../services/notifier.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = path.resolve(__dirname, "../../uploads/snapshots");

export const detectorEventsRouter = Router();
detectorEventsRouter.use(requireDetectorKey);

// Single webhook the Python service posts every session/violation/job event to.
// Kept as one endpoint (rather than one per event type) because the detector
// only needs to know one URL, and the event `type` decides how we handle it.
detectorEventsRouter.post("/", async (req, res, next) => {
  try {
    const event = req.body;
    switch (event.type) {
      case "session_started":
      case "session_updated":
        await upsertSession(event);
        break;
      case "session_ended":
        await upsertSession(event, { status: "closed" });
        break;
      case "violation":
        await handleViolation(event);
        break;
      case "job_progress":
        await Video.findByIdAndUpdate(event.videoId, { progress: event.progress, status: "running" });
        notifyControllers("job:progress", { videoId: event.videoId, progress: event.progress });
        break;
      case "job_finished":
        await Video.findByIdAndUpdate(event.videoId, { status: event.status, progress: 100 });
        notifyControllers("job:finished", { videoId: event.videoId, status: event.status });
        break;
      case "job_failed":
        await Video.findByIdAndUpdate(event.videoId, { status: "failed", error: event.error });
        notifyControllers("job:failed", { videoId: event.videoId, error: event.error });
        break;
      default:
        return res.status(400).json({ error: `Unknown event type: ${event.type}` });
    }
    res.status(202).json({ ok: true });
  } catch (err) { next(err); }
});

async function upsertSession(event, extra = {}) {
  const s = event.session;
  const doc = await ParkingSession.findOneAndUpdate(
    { sessionKey: s.sessionId },
    {
      sessionKey: s.sessionId, video: event.videoId, trackId: s.trackId,
      zoneName: s.zoneName, zoneType: s.zoneType, vehicleType: s.vehicleType,
      plate: s.plate, plateConfidence: s.plateConfidence,
      startedAt: s.startedAt, endedAt: s.endedAt, durationSeconds: s.durationSeconds,
      ...extra,
    },
    { upsert: true, new: true }
  );
  notifyControllers("session:update", { videoId: event.videoId, session: doc });
  return doc;
}

async function handleViolation(event) {
  const session = await upsertSession(event, { isViolation: true });

  const filename = `${session.sessionKey}-${Date.now()}.jpg`;
  if (event.snapshot) {
    await fs.mkdir(SNAPSHOT_DIR, { recursive: true });
    await fs.writeFile(path.join(SNAPSHOT_DIR, filename), Buffer.from(event.snapshot, "base64"));
  }

  const violation = await Violation.create({
    session: session._id, video: event.videoId, zoneName: session.zoneName,
    vehicleType: session.vehicleType, plate: session.plate,
    durationSeconds: session.durationSeconds,
    snapshotPath: event.snapshot ? `uploads/snapshots/${filename}` : "",
  });

  // Automatic fine, as the project requires: no controller action needed to issue it.
  const fine = await issueFineForViolation(violation);
  violation.fine = fine._id;
  await violation.save();

  // Immediate push to every connected controller dashboard.
  notifyControllers("violation:new", {
    videoId: event.videoId,
    violation: await violation.populate("fine"),
  });
}
