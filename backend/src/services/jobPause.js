import { getJobStatus, pauseDetectionJob } from "./detectorClient.js";
import { Video } from "../models/Video.js";

const conflict = (message) => Object.assign(new Error(message), { status: 409 });
const sleepFor = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadCheckpoint(video) {
  const doc = await Video.findById(video._id).select("+checkpoint").lean();
  return doc?.checkpoint ?? null;
}

/**
 * Pauses a running job and returns the checkpoint to resume from.
 *
 * The detector finishes the frame it is on, keeps every parked vehicle open, and records
 * exactly where it got to. We wait until it really has stopped (so the detector is free for
 * another video the moment this returns) and take the checkpoint from its own answer rather
 * than from an event that might still be on its way.
 *
 * If the detector has lost the job (it restarted), the last saved checkpoint is used instead.
 */
export async function pauseJob(video, {
  pause = pauseDetectionJob, getStatus = getJobStatus, load = loadCheckpoint,
  sleep = sleepFor, timeoutMs = 30000, pollMs = 250,
} = {}) {
  try {
    await pause(video.jobId);
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const job = await getStatus(video.jobId);
      if (job.status === "paused") return job.checkpoint ?? (await load(video));
      if (!["queued", "running"].includes(job.status)) {
        throw conflict(`This job had already ${job.status === "failed" ? "failed" : "finished"}, so it cannot be paused`);
      }
      if (Date.now() > deadline) {
        throw Object.assign(new Error("The detector did not pause in time - try again in a moment"), { status: 504 });
      }
      await sleep(pollMs);
    }
  } catch (err) {
    if (err.status !== 404) throw err;
    // The detector no longer knows this job. If progress had been saved we can still pause it.
    const saved = await load(video);
    if (saved) return saved;
    throw conflict("The detector lost this job before any progress was saved, so it cannot be paused. Stop it and start again.");
  }
}
