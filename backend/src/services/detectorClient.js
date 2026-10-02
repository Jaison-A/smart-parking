import { env } from "../config/env.js";

// Talks to the Python FastAPI detection service.
async function call(path, options = {}) {
  const res = await fetch(`${env.detectorUrl}${path}`, {
    ...options,
    headers: { "x-detector-key": env.detectorApiKey, "Content-Type": "application/json", ...options.headers },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw Object.assign(new Error(`Detector service error (${res.status}): ${body}`), { status: 502 });
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
