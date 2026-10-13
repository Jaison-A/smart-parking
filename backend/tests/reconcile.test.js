import test from "node:test";
import assert from "node:assert/strict";
import { reconcileVideo, LOST_JOB_MESSAGE } from "../src/services/jobReconciler.js";

const video = (over = {}) => ({ _id: "v1", status: "running", jobId: "j1", ...over });
const recorder = () => {
  const calls = [];
  return { calls, settle: async (v, args) => { calls.push(args); } };
};
const notFound = () => Object.assign(new Error("Unknown job"), { status: 404 });

test("a running video whose job the detector no longer knows is marked failed", async () => {
  const r = recorder();
  await reconcileVideo(video(), { getStatus: async () => { throw notFound(); }, settle: r.settle });
  assert.deepEqual(r.calls, [{ status: "failed", error: LOST_JOB_MESSAGE }]);
});

test("a job that is still running is left alone", async () => {
  const r = recorder();
  await reconcileVideo(video(), { getStatus: async () => ({ status: "running" }), settle: r.settle });
  assert.equal(r.calls.length, 0);
});

test("a job that already finished (event missed) is settled with its real status", async () => {
  const r = recorder();
  await reconcileVideo(video(), { getStatus: async () => ({ status: "completed" }), settle: r.settle });
  assert.deepEqual(r.calls, [{ status: "completed", error: undefined }]);
});

test("an unreachable detector changes nothing (can't tell lost from unreachable)", async () => {
  const r = recorder();
  const down = () => { throw Object.assign(new Error("down"), { status: 503 }); };
  await reconcileVideo(video(), { getStatus: down, settle: r.settle });
  assert.equal(r.calls.length, 0);
});

test("videos that aren't in flight never trigger a detector call", async () => {
  let asked = false;
  await reconcileVideo(video({ status: "completed" }), { getStatus: async () => { asked = true; return {}; } });
  await reconcileVideo(video({ jobId: undefined }), { getStatus: async () => { asked = true; return {}; } });
  assert.equal(asked, false);
});
