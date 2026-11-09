import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { safeUploadPath, collectFilePaths } from "../src/services/testData.js";

const root = path.resolve("/srv/app");

test("files inside uploads/ may be deleted", () => {
  assert.equal(safeUploadPath("uploads/snapshots/a.jpg", root), path.join(root, "uploads/snapshots/a.jpg"));
  assert.equal(safeUploadPath("uploads/videos/v.mp4", root), path.join(root, "uploads/videos/v.mp4"));
});

test("anything that points outside uploads/ is refused", () => {
  for (const bad of ["../.env", "uploads/../.env", "uploads/../../etc/passwd", "/etc/passwd", "src/app.js", "uploads", "", null, undefined]) {
    assert.equal(safeUploadPath(bad, root), null, String(bad));
  }
});

test("every evidence photo and the video file are collected, once each", () => {
  const files = collectFilePaths({
    videos: [{ storedName: "v1.mp4" }, { storedName: undefined }],
    violations: [{ snapshotPath: "uploads/snapshots/a.jpg", entrySnapshotPath: "uploads/snapshots/b.jpg", exitSnapshotPath: null }],
    sessions: [{ entrySnapshotPath: "uploads/snapshots/b.jpg", exitSnapshotPath: "uploads/snapshots/c.jpg" }],
  });
  assert.deepEqual(files.sort(), ["uploads/snapshots/a.jpg", "uploads/snapshots/b.jpg", "uploads/snapshots/c.jpg", "uploads/videos/v1.mp4"]);
});
