import test from "node:test";
import assert from "node:assert/strict";
import { reconcileVideo, resumeLostJob, MAX_AUTO_RESUMES, LOST_JOB_MESSAGE } from "../src/services/jobReconciler.js";

const video = (over = {}) => ({ _id: "v1", status: "running", jobId: "j1", ...over });
const recorder = () => {
  const calls = [];
  return { calls, settle: async (v, args) => { calls.push(args); } };
};
const notFound = () => Object.assign(new Error("Unknown job"), { status: 404 });

test("a running video whose job the detector no longer knows is marked failed", async () => {
  const r = recorder();
  await reconcileVideo(video(), { getStatus: async () => { throw notFound(); }, settle: r.settle, resume: async () => false });
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


test("a lost job that CAN be resumed is not settled as failed", async () => {
  const r = recorder();
  await reconcileVideo(video(), { getStatus: async () => { throw notFound(); }, settle: r.settle, resume: async () => true });
  assert.equal(r.calls.length, 0);
});

// ---- resumeLostJob
const checkpoint = { frame_no: 120, wall_start: "2026-10-24T10:00:00Z", sessions: [{ session_id: "s1" }] };
const resumeDeps = (over = {}) => {
  const seen = { launched: [], notified: [] };
  return {
    seen,
    deps: {
      load: async () => checkpoint,
      launch: async (v, opts) => { seen.launched.push(opts); },
      notify: (event, payload) => seen.notified.push([event, payload]),
      ...over,
    },
  };
};

test("resuming restarts the job from the saved checkpoint and tells the dashboards", async () => {
  const { seen, deps } = resumeDeps();
  assert.equal(await resumeLostJob(video({ _id: "v1", resumeCount: 0 }), deps), true);
  assert.deepEqual(seen.launched, [{ resume: checkpoint }]);
  assert.deepEqual(seen.notified, [["job:resumed", { videoId: "v1" }]]);
});

test("no checkpoint (the job died before saving one) means it cannot be resumed", async () => {
  const { seen, deps } = resumeDeps({ load: async () => null });
  assert.equal(await resumeLostJob(video(), deps), false);
  assert.equal(seen.launched.length, 0);
});

test("a job that keeps getting lost is not restarted forever", async () => {
  const { seen, deps } = resumeDeps();
  assert.equal(await resumeLostJob(video({ resumeCount: MAX_AUTO_RESUMES }), deps), false);
  assert.equal(seen.launched.length, 0);
});

test("if the restart itself fails, resuming reports false so the job is settled instead", async () => {
  const { deps } = resumeDeps({ launch: async () => { throw new Error("detector refused"); } });
  assert.equal(await resumeLostJob(video(), deps), false);
});

test("two checks of the same lost job at once resume it only once, and never mark it failed", async () => {
  let resumes = 0, settles = 0;
  const deps = {
    getStatus: async () => { throw notFound(); },
    resume: async () => { resumes++; await new Promise((r) => setTimeout(r, 20)); return true; },
    settle: async () => { settles++; },
  };
  const v = video({ _id: "same-video" });
  await Promise.all([reconcileVideo(v, deps), reconcileVideo(v, deps), reconcileVideo(v, deps)]);
  assert.equal(resumes, 1);
  assert.equal(settles, 0);
});

test("different videos are checked independently", async () => {
  let resumes = 0;
  const deps = { getStatus: async () => { throw notFound(); }, resume: async () => { resumes++; return true; }, settle: async () => {} };
  await Promise.all([reconcileVideo(video({ _id: "a" }), deps), reconcileVideo(video({ _id: "b" }), deps)]);
  assert.equal(resumes, 2);
});
