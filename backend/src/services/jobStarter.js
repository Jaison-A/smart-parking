import path from "node:path";
import { fileURLToPath } from "node:url";
import { v4 as uuid } from "uuid";
import { Zone } from "../models/Zone.js";
import { env } from "../config/env.js";
import { startDetectionJob } from "./detectorClient.js";
import { getFineSettings } from "./settingsService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const VIDEO_DIR = path.resolve(__dirname, "../../uploads/videos");

// What to hand the detector: a live camera uses its own URL/index as-is. An uploaded file
// uses a local path when detector and backend share a disk (normal local dev), or this
// backend's own public URL to the file when they don't (PUBLIC_BASE_URL set). Either way
// the detector is told explicitly whether this is a live source, not left to guess.
export function videoSource(video) {
  if (video.sourceType === "stream") return { path: video.streamUrl, isLive: true };
  const path_ = env.publicBaseUrl
    ? `${env.publicBaseUrl.replace(/\/$/, "")}/uploads/videos/${video.storedName}`
    : path.join(VIDEO_DIR, video.storedName);
  // A test image never "ends" - the detector keeps re-reading it until Stop.
  return { path: path_, isLive: video.sourceType === "image" };
}

/**
 * Starts (or, with `resume`, restarts) the detection job for a video and records it on
 * the video. `resume` is the checkpoint the detector saved: carry on from there.
 */
export async function launchJob(video, { params, resume, manual = false } = {}) {
  const zones = await Zone.find({ video: video._id });
  if (zones.length === 0) {
    throw Object.assign(new Error("Draw at least one zone on this video before starting detection"), { status: 400 });
  }
  const settings = await getFineSettings();
  const jobId = uuid();
  const source = videoSource(video);
  await startDetectionJob({
    jobId, videoId: video._id.toString(),
    videoPath: source.path, isLive: source.isLive, zones,
    // Settings page -> detector: bays can be switched off without touching the zones.
    params: { bay_rules_enabled: settings.bayRulesEnabled, ...params },
    resume,
  });

  video.jobId = jobId;
  video.status = "queued";
  video.error = undefined;
  if (resume) {
    // Automatic resumes are counted (and capped) so a crash loop can't go on forever; a person
    // clicking Resume is not a crash and is not counted.
    if (!manual) video.resumeCount = (video.resumeCount || 0) + 1;
  } else {
    video.progress = 0;
    video.resumeCount = 0;
    video.checkpoint = undefined;                           // a fresh run starts from nothing
  }
  await video.save();
  return video;
}
