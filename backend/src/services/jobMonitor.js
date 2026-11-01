import { Video } from "../models/Video.js";
import { reconcileVideo } from "./jobReconciler.js";

/**
 * Every so often, check that each video marked queued/running still has a live job, and
 * resume (or settle) the ones that lost theirs. Without this, a restarted detector would
 * only be noticed when someone happened to open the page.
 */
export function startJobMonitor(intervalMs = 15000) {
  let busy = false;
  const tick = async () => {
    if (busy) return; // a slow check must not overlap the next one
    busy = true;
    try {
      const videos = await Video.find({ status: { $in: ["queued", "running"] }, jobId: { $exists: true } });
      for (const video of videos) await reconcileVideo(video);
    } catch (err) {
      console.error("[monitor] check failed:", err.message);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
