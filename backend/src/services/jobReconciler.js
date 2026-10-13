import { ParkingSession } from "../models/ParkingSession.js";
import { Violation } from "../models/Violation.js";
import { getJobStatus } from "./detectorClient.js";

const IN_FLIGHT = ["queued", "running"];
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
 * A video marked queued/running is only a claim - the detector holds the truth, and
 * it keeps jobs in memory, so a restart silently loses them. Ask it. If the job is
 * gone, correct the record; if the detector can't be reached, say nothing (we can't
 * tell the difference between "lost" and "temporarily unreachable").
 */
export async function reconcileVideo(video, { getStatus = getJobStatus, settle = settleOrphanedJob } = {}) {
  if (!IN_FLIGHT.includes(video.status) || !video.jobId) return video;
  try {
    const job = await getStatus(video.jobId);
    if (!IN_FLIGHT.includes(job.status)) {
      // It already ended and we missed the event.
      await settle(video, { status: job.status, error: job.error || undefined });
    }
  } catch (err) {
    if (err.status === 404) await settle(video, { status: "failed", error: LOST_JOB_MESSAGE });
  }
  return video;
}
