import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Video } from "../models/Video.js";
import { Zone } from "../models/Zone.js";
import { ParkingSession } from "../models/ParkingSession.js";
import { Violation } from "../models/Violation.js";
import { Fine } from "../models/Fine.js";
import { NotificationLog } from "../models/NotificationLog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "../..");
const UPLOADS_DIR = path.join(BACKEND_ROOT, "uploads");
const IN_FLIGHT = ["queued", "running", "paused"];

/** Absolute path of a stored file, or null if it would point outside uploads/ (never delete those). */
export function safeUploadPath(relative, root = BACKEND_ROOT) {
  if (!relative || typeof relative !== "string") return null;
  const uploads = path.join(root, "uploads");
  const abs = path.resolve(root, relative);
  return abs.startsWith(uploads + path.sep) ? abs : null;
}

/** Every file on disk that belongs to the given records (video file + evidence photos). */
export function collectFilePaths({ videos = [], violations = [], sessions = [] }) {
  const rel = new Set();
  for (const v of videos) if (v.storedName) rel.add(`uploads/videos/${v.storedName}`);
  for (const r of [...violations, ...sessions]) {
    for (const f of ["snapshotPath", "entrySnapshotPath", "exitSnapshotPath"]) if (r[f]) rel.add(r[f]);
  }
  return [...rel];
}

export async function testDataSummary() {
  const videos = await Video.find({ isTest: true }).select("originalName status");
  const ids = videos.map((v) => v._id);
  const violationIds = (await Violation.find({ video: { $in: ids } }).select("_id")).map((v) => v._id);
  return {
    videos: videos.length,
    violations: violationIds.length,
    fines: await Fine.countDocuments({ violation: { $in: violationIds } }),
    sessions: await ParkingSession.countDocuments({ video: { $in: ids } }),
    running: videos.filter((v) => IN_FLIGHT.includes(v.status)).map((v) => v.originalName),
  };
}

/** Deletes every test video and everything that hangs off it. Refuses while one is running. */
export async function deleteTestData() {
  const videos = await Video.find({ isTest: true });
  const running = videos.filter((v) => IN_FLIGHT.includes(v.status));
  if (running.length) {
    throw Object.assign(
      new Error(`Stop detection first on: ${running.map((v) => v.originalName).join(", ")}`),
      { status: 409 }
    );
  }
  const ids = videos.map((v) => v._id);
  const violations = await Violation.find({ video: { $in: ids } }).select("snapshotPath entrySnapshotPath exitSnapshotPath");
  const sessions = await ParkingSession.find({ video: { $in: ids } }).select("entrySnapshotPath exitSnapshotPath");
  const violationIds = violations.map((v) => v._id);

  await NotificationLog.deleteMany({ violation: { $in: violationIds } });
  const fines = await Fine.deleteMany({ violation: { $in: violationIds } });
  await Violation.deleteMany({ video: { $in: ids } });
  await ParkingSession.deleteMany({ video: { $in: ids } });
  await Zone.deleteMany({ video: { $in: ids } });
  await Video.deleteMany({ _id: { $in: ids } });

  let filesRemoved = 0;
  for (const rel of collectFilePaths({ videos, violations, sessions })) {
    const abs = safeUploadPath(rel);
    if (!abs) continue;
    try { await fs.unlink(abs); filesRemoved++; } catch { /* already gone */ }
  }
  return {
    videos: videos.length, violations: violations.length, fines: fines.deletedCount,
    sessions: sessions.length, filesRemoved,
  };
}
