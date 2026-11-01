import { ParkingSession } from "../models/ParkingSession.js";
import { Violation } from "../models/Violation.js";
import { Video } from "../models/Video.js";
import { getJobStatus } from "./detectorClient.js";
import { launchJob } from "./jobStarter.js";
import { notifyControllers } from "./notifier.js";

const IN_FLIGHT = ["queued", "running"];
// A job that keeps getting lost (a crash loop) must not be restarted forever.
export const MAX_AUTO_RESUMES = 3;
export const LOST_JOB_MESSAGE =
  "Detection was interrupted - the detection service restarted and lost this job. Start it again.";

/**
 * Close out everything a vanished job left open, so nothing stays "running" or
 * "still parked" forever. Sessions and violations are closed as of the last time
 * the detector reported in (we can't know any later than that).
 */
export async function settleOrphanedJob(video, { status, error }) {
  const stoppedAt = video.updatedAt || new Date();

  const open = await ParkingSession.find({ video: video._id, status: "active" }).select("_id");
  if (open.length) {
    const ids = open.map((s) => s._id);
    await ParkingSession.updateMany({ _id: { $in: ids } }, { status: "closed", endedAt: stoppedAt });
    await Violation.updateMany({ session: { $in: ids }, finalized: false }, { finalized: true, endedAt: stoppedAt });
  }

  video.status = status;
  video.error = error;
  if (status === "completed") video.progress = 100;
  await video.save();
  return video;
}

/**
 * A lost job, restarted from its last saved checkpoint instead of failing. The open
 * sessions are NOT closed: the restarted detector hands them back to the vehicles that
 * are still there, so parked time carries on and nobody is fined twice.
 * Returns true if a job was restarted, false if it could not be (caller then settles).
 */
export async function resumeLostJob(video, { load = loadCheckpoint, launch = launchJob, notify = notifyControllers } = {}) {
  if ((video.resumeCount || 0) >= MAX_AUTO_RESUMES) return false;
  const checkpoint = await load(video);
  if (!checkpoint || typeof checkpoint.frame_no !== "number") return false; // died before its first checkpoint
  try {
    await launch(video, { resume: checkpoint });
    notify("job:resumed", { videoId: video._id.toString() });
    return true;
  } catch (err) {
    console.error(`[resume] could not resume video ${video._id}:`, err.message);
    return false;
  }
}

async function loadCheckpoint(video) {
  const doc = await Video.findById(video._id).select("+checkpoint").lean();
  return doc?.checkpoint ?? null;
}

/**
 * A video marked queued/running is only a claim - the detector holds the truth, and it
 * keeps jobs in memory, so a restart silently loses them. Ask it. If the job is gone,
 * resume it from its checkpoint when possible, otherwise correct the record. If the
 * detector can't be reached, say nothing: we can't tell "lost" from "unreachable".
 */
const checking = new Map(); // video id -> the check already running for it

export function reconcileVideo(video, deps) {
  // The monitor and a page load can notice the same lost job at the same moment. Only one
  // check may run per video: a second "resume" would be refused by the detector (it runs
  // one job at a time) and that refusal would wrongly mark the resumed video as failed.
  const key = String(video._id);
  if (checking.has(key)) return checking.get(key).then(() => video);
  const run = check(video, deps).finally(() => checking.delete(key));
  checking.set(key, run);
  return run;
}

async function check(
  video,
  { getStatus = getJobStatus, settle = settleOrphanedJob, resume = resumeLostJob } = {}
) {
  if (!IN_FLIGHT.includes(video.status) || !video.jobId) return video;
  try {
    const job = await getStatus(video.jobId);
    if (!IN_FLIGHT.includes(job.status)) {
      // It already ended and we missed the event.
      await settle(video, { status: job.status, error: job.error || undefined });
    }
  } catch (err) {
    if (err.status === 404) {
      if (!(await resume(video))) await settle(video, { status: "failed", error: LOST_JOB_MESSAGE });
    }
  }
  return video;
}
