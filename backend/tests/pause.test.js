import test from "node:test";
import assert from "node:assert/strict";
import { pauseJob } from "../src/services/jobPause.js";

const video = { _id: "v1", jobId: "j1" };
const CP = { frame_no: 120, wall_start: "2026-10-24T10:00:00Z", sessions: [{ session_id: "s1" }] };
const noSleep = async () => {};
const notFound = () => Object.assign(new Error("Unknown job"), { status: 404 });

function detector(sequence) {
  const calls = { paused: 0, polls: 0 };
  return {
    calls,
    deps: {
      pause: async () => { calls.paused++; },
      getStatus: async () => { const s = sequence[Math.min(calls.polls++, sequence.length - 1)]; if (s instanceof Error) throw s; return s; },
      sleep: noSleep,
    },
  };
}

test("pausing waits until the detector has really stopped, then returns its checkpoint", async () => {
  const d = detector([{ status: "running" }, { status: "running" }, { status: "paused", checkpoint: CP }]);
  assert.deepEqual(await pauseJob(video, { ...d.deps, load: async () => null }), CP);
  assert.equal(d.calls.paused, 1);
  assert.equal(d.calls.polls, 3);                       // it did not return while the detector was still busy
});

test("a job that finishes by itself before the pause takes effect cannot be paused", async () => {
  const d = detector([{ status: "running" }, { status: "completed" }]);
  await assert.rejects(pauseJob(video, { ...d.deps, load: async () => null }), (e) => e.status === 409 && /already finished/.test(e.message));
  const f = detector([{ status: "failed" }]);
  await assert.rejects(pauseJob(video, { ...f.deps, load: async () => null }), /already failed/);
});

test("a detector that never pauses times out with a clear message", async () => {
  const d = detector([{ status: "running" }]);
  await assert.rejects(pauseJob(video, { ...d.deps, load: async () => null, timeoutMs: -1 }), (e) => e.status === 504);
});

test("if the checkpoint is missing from the answer, the saved one is used", async () => {
  const d = detector([{ status: "paused" }]);
  assert.deepEqual(await pauseJob(video, { ...d.deps, load: async () => CP }), CP);
});

test("a job the detector has lost can still be paused from its last saved checkpoint", async () => {
  const d = detector([notFound()]);
  d.deps.pause = async () => { throw notFound(); };
  assert.deepEqual(await pauseJob(video, { ...d.deps, load: async () => CP }), CP);
});

test("a lost job with nothing saved cannot be paused, and says why", async () => {
  const d = detector([notFound()]);
  d.deps.pause = async () => { throw notFound(); };
  await assert.rejects(pauseJob(video, { ...d.deps, load: async () => null }), (e) => e.status === 409 && /lost this job/.test(e.message));
});

test("other detector errors are passed on, not swallowed", async () => {
  const d = detector([]);
  d.deps.pause = async () => { throw Object.assign(new Error("detector down"), { status: 503 }); };
  await assert.rejects(pauseJob(video, { ...d.deps, load: async () => CP }), (e) => e.status === 503);
});
