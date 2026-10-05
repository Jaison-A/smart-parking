import { env } from "../config/env.js";

// Talks to the Python FastAPI detection service.
async function call(path, options = {}) {
  let res;
  try {
    res = await fetch(`${env.detectorUrl}${path}`, {
      ...options,
      headers: { "x-detector-key": env.detectorApiKey, "Content-Type": "application/json", ...options.headers },
    });
  } catch {
    // The detector genuinely isn't reachable (not running, wrong port, etc).
    // 503 "Service Unavailable" is the honest code for that - not 502.
    throw Object.assign(
      new Error(`Can't reach the detection service at ${env.detectorUrl} - is it running?`),
      { status: 503 }
    );
  }
  if (!res.ok) {
    // Forward the detector's own message and status instead of flattening every
    // failure into a generic 502 - "Video not found inside the allowed video
    // folder" is actionable; "Detector service error (502)" is not.
    const body = await res.text().catch(() => "");
    let message = body;
    try { message = JSON.parse(body).detail || body; } catch { /* not JSON, use as-is */ }
    throw Object.assign(new Error(message || `Detector returned ${res.status}`), { status: res.status });
  }
  return res.headers.get("content-type")?.includes("application/json") ? res.json() : res;
}

export function startDetectionJob({ jobId, videoId, videoPath, zones, params }) {
  return call("/jobs", {
    method: "POST",
    body: JSON.stringify({
      job_id: jobId,
      video_id: videoId,
      video_path: videoPath,
      zones: zones.map((z) => ({
        id: z._id.toString(),
        name: z.name,
        type: z.type,
        points: z.points.map((p) => [p.x, p.y]),
      })),
      ...(params && { params }),
    }),
  });
}

export function stopDetectionJob(jobId) {
  return call(`/jobs/${jobId}/stop`, { method: "POST" });
}

export function detectorFrameUrl(videoPath) {
  return `${env.detectorUrl}/frame?path=${encodeURIComponent(videoPath)}`;
}

export async function fetchFirstFrame(videoPath) {
  const res = await call(`/frame?path=${encodeURIComponent(videoPath)}`);
  return Buffer.from(await res.arrayBuffer());
}
