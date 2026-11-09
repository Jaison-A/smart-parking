/**
 * End-to-end test: the REAL Express app, real routes, a real MongoDB-compatible database, and a
 * fake detection service. It walks through the audit log, test data, owner messages, plate
 * counters, per-zone spacing, and resuming a lost job - the things that unit tests cannot prove.
 *
 * Skipped unless a database is available:
 *     TEST_MONGO_URI=mongodb://127.0.0.1:27017 node --test tests/integration.test.js
 * (a fresh, uniquely-named database is created and dropped)
 */
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MONGO = process.env.TEST_MONGO_URI;
const here = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS = path.resolve(here, "../uploads");

// ---------------------------------------------------------------- fake detection service
function startFakeDetector() {
  const state = { known: new Set(), started: [], stopped: [], pausedCalls: [], paused: new Map(), rejectStart: false, nextCheckpoint: null };
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
      const m = req.url.match(/^\/jobs\/([^/]+)(\/stop|\/pause)?$/);
      if (m && m[2] === "/pause" && req.method === "POST") {
        if (!state.known.has(m[1])) return send(404, { detail: "Unknown job" });
        state.pausedCalls.push(m[1]);
        state.paused.set(m[1], state.nextCheckpoint ?? { frame_no: 100, wall_start: "2026-10-20T10:00:00+00:00", sessions: [] });
        return send(200, { jobId: m[1], pausing: true });
      }
      if (req.method === "POST" && req.url === "/jobs") {
        if (state.rejectStart) return send(409, { detail: "A detection job is already running" });
        const body = JSON.parse(raw);
        state.started.push(body); state.known.add(body.job_id);
        return send(202, { jobId: body.job_id, status: "queued" });
      }
      if (m && req.method === "GET") {
        if (state.paused.has(m[1])) return send(200, { status: "paused", progress: 1, checkpoint: state.paused.get(m[1]) });
        return state.known.has(m[1]) ? send(200, { status: "running", progress: 1 }) : send(404, { detail: "Unknown job" });
      }
      if (m && m[2] === "/stop" && req.method === "POST") { state.stopped.push(m[1]); return send(200, { stopping: true }); }
      send(404, { detail: "not found" });
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () =>
    resolve({ state, server, url: `http://127.0.0.1:${server.address().port}` })));
}

describe("integration (real app + real database)", { skip: !MONGO && "set TEST_MONGO_URI to run" }, () => {
  let base, httpServer, fake, mongoose, M, env, admin, controller;
  const ids = {};

  const api = async (method, url, { token, body, headers } = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, body: json, text };
  };
  const event = (e) => api("POST", "/api/detector/events", { headers: { "x-detector-key": env.detectorApiKey }, body: e });
  const audit = async (query = "") => (await api("GET", `/api/audit?limit=200${query}`, { token: admin.token })).body.entries;
  const until = async (fn, ms = 3000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await new Promise((r) => setTimeout(r, 40)); } };

  const sessionPayload = (over = {}) => ({
    sessionId: "sess-1", trackId: 1, zoneId: ids.gateZone, zoneName: "Gate", zoneType: "no_parking",
    vehicleType: "car", plate: null, plateConfidence: null,
    startedAt: new Date("2026-10-20T10:00:00Z").toISOString(), endedAt: null, durationSeconds: 8,
    bayName: null, plateReads: 3, plateStatus: "reading", videoStart: 12.5, videoEnd: null,
    violationKind: null, violationDetail: null, ...over,
  });

  before(async () => {
    fake = await startFakeDetector();
    process.env.DETECTOR_URL = fake.url;
    process.env.MONGO_URI = `${MONGO}/itest_${Date.now()}`;
    ({ env } = await import("../src/config/env.js"));
    mongoose = (await import("mongoose")).default;
    const { createApp } = await import("../src/app.js");
    const { initSockets } = await import("../src/sockets/index.js");
    M = {
      Video: (await import("../src/models/Video.js")).Video, Zone: (await import("../src/models/Zone.js")).Zone,
      Session: (await import("../src/models/ParkingSession.js")).ParkingSession,
      Violation: (await import("../src/models/Violation.js")).Violation, Fine: (await import("../src/models/Fine.js")).Fine,
      Owner: (await import("../src/models/Owner.js")).Owner, Log: (await import("../src/models/NotificationLog.js")).NotificationLog,
    };
    await mongoose.connect(env.mongoUri);
    httpServer = http.createServer(createApp());
    initSockets(httpServer);
    await new Promise((r) => httpServer.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${httpServer.address().port}`;
    fs.mkdirSync(path.join(UPLOADS, "videos"), { recursive: true });
    fs.mkdirSync(path.join(UPLOADS, "snapshots"), { recursive: true });
  });

  after(async () => {
    await mongoose?.connection?.dropDatabase?.().catch(() => {});
    await mongoose?.disconnect();
    httpServer?.close(); fake?.server.close();
  });

  // ------------------------------------------------------------------ accounts
  test("the first account is an admin, the next is a controller", async () => {
    const a = await api("POST", "/api/auth/register", { body: { name: "Asha Admin", email: "admin@x.com", password: "secret1" } });
    const c = await api("POST", "/api/auth/register", { body: { name: "Carl Controller", email: "ctl@x.com", password: "secret1" } });
    assert.equal(a.status, 201); assert.equal(c.status, 201);
    assert.equal(a.body.user.role, "admin"); assert.equal(c.body.user.role, "controller");
    admin = { token: a.body.token, id: a.body.user._id }; controller = { token: c.body.token };
  });

  // ------------------------------------------------------------------ 1. audit log: settings
  test("AUDIT: changing a setting is recorded with who, what changed (before and after) and when", async () => {
    const put = await api("PUT", "/api/settings", { token: admin.token, body: { baseAmount: 500, rate: 25, rateUnit: "minute", roundUp: true, ruleAmount: 200, bayRulesEnabled: true } });
    assert.equal(put.status, 200, put.text);
    const entry = (await audit()).find((e) => e.action === "settings.update");
    assert.ok(entry, "no settings.update entry in the audit log");
    assert.equal(entry.actorName, "Asha Admin"); assert.equal(entry.actorRole, "admin");
    assert.deepEqual(entry.changes.map((c) => [c.field, c.from, c.to]), [["rate", 20, 25]]);
    assert.ok(entry.createdAt);
  });

  test("AUDIT: saving the same values again records nothing new", async () => {
    const before = (await audit()).length;
    await api("PUT", "/api/settings", { token: admin.token, body: { baseAmount: 500, rate: 25, rateUnit: "minute", roundUp: true, ruleAmount: 200, bayRulesEnabled: true } });
    assert.equal((await audit()).length, before);
  });

  test("AUDIT: a controller can neither change settings nor read the audit log", async () => {
    assert.equal((await api("PUT", "/api/settings", { token: controller.token, body: { baseAmount: 1, rate: 1, rateUnit: "minute", roundUp: true, ruleAmount: 1 } })).status, 403);
    assert.equal((await api("GET", "/api/audit", { token: controller.token })).status, 403);
    assert.equal((await api("GET", "/api/audit")).status, 401);
  });

  // ------------------------------------------------------------------ videos, zones, 4. per-zone spacing
  test("setup: a video with a no-parking zone, a parking zone and a bay", async () => {
    const v = await M.Video.create({ originalName: "lot.mp4", sourceType: "upload", storedName: "lot.mp4", sizeBytes: 10, uploadedBy: admin.id });
    ids.video = String(v._id);
    const pts = [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }];
    for (const [key, name, type] of [["gateZone", "Gate", "no_parking"], ["lotZone", "Lot", "parking"], ["bayZone", "Bay 1", "bay"]]) {
      const z = await api("POST", "/api/zones", { token: admin.token, body: { name, type, points: pts, video: ids.video } });
      assert.equal(z.status, 201, z.text); ids[key] = z.body.zone._id;
    }
  });

  test("ZONES: spacing can be switched off or given its own gap per zone, and the change is audited", async () => {
    const r = await api("PATCH", `/api/zones/${ids.lotZone}`, { token: admin.token, body: { ignoreSpacing: true, minGapRatio: 0.1 } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.zone.ignoreSpacing, true); assert.equal(r.body.zone.minGapRatio, 0.1);
    const saved = await M.Zone.findById(ids.lotZone).lean();
    assert.equal(saved.ignoreSpacing, true); assert.equal(saved.minGapRatio, 0.1);
    const entry = (await audit("&action=zone")).find((e) => e.action === "zone.update");
    assert.ok(entry, "zone change not audited");
    assert.deepEqual(entry.changes.map((c) => c.field).sort(), ["ignoreSpacing", "minGapRatio"]);
  });

  test("ZONES: nonsense spacing values are rejected", async () => {
    for (const body of [{ minGapRatio: -1 }, { minGapRatio: 5 }, { minGapRatio: "wide" }, { ignoreSpacing: "yes" }]) {
      assert.equal((await api("PATCH", `/api/zones/${ids.lotZone}`, { token: admin.token, body })).status, 400, JSON.stringify(body));
    }
  });

  // ------------------------------------------------------------------ 9. owners
  test("OWNERS: registering needs consent; plates are unique; every change is audited", async () => {
    const body = { name: "Ravi Kumar", phone: "98765 43210", plates: "tn09 ab 1234", channels: { sms: true, whatsapp: false }, consentGiven: true, consentNote: "signed form" };
    assert.equal((await api("POST", "/api/owners", { token: admin.token, body: { ...body, consentGiven: false } })).status, 400);
    const ok = await api("POST", "/api/owners", { token: admin.token, body });
    assert.equal(ok.status, 201, ok.text);
    assert.equal(ok.body.owner.phone, "+919876543210"); assert.deepEqual(ok.body.owner.plates, ["TN09AB1234"]);
    ids.owner = ok.body.owner._id;
    const dup = await api("POST", "/api/owners", { token: admin.token, body: { ...body, name: "Someone Else" } });
    assert.equal(dup.status, 409); assert.match(dup.body.error, /TN09AB1234/);
    assert.equal((await api("GET", "/api/owners", { token: controller.token })).status, 403); // personal data: admins only
    const created = (await audit("&action=owner")).find((e) => e.action === "owner.create");
    assert.ok(created); assert.ok(!JSON.stringify(created).includes("98765"), "the audit log must not hold the full phone number");
  });

  // ------------------------------------------------------------------ events: 2, 3, 5, 8, 9
  test("EVENTS: a session reports how many plate reads it has had, and where in the video it started", async () => {
    assert.equal((await event({ type: "session_started", jobId: "j1", videoId: ids.video, session: sessionPayload() })).status, 202);
    const s = await M.Session.findOne({ sessionKey: "sess-1" }).lean();
    assert.equal(s.plateReads, 3); assert.equal(s.plateStatus, "reading"); assert.equal(s.videoStartSeconds, 12.5);
    await event({ type: "session_updated", jobId: "j1", videoId: ids.video, session: sessionPayload({ plateReads: 9, plateStatus: "unreadable" }) });
    const s2 = await M.Session.findOne({ sessionKey: "sess-1" }).lean();
    assert.equal(s2.plateReads, 9); assert.equal(s2.plateStatus, "unreadable");
  });

  test("EVENTS: a violation gets a fine at the CURRENT rates, and a registered owner is messaged (demo sender)", async () => {
    const r = await event({ type: "violation", jobId: "j1", videoId: ids.video,
      session: sessionPayload({ plate: "TN09AB1234", plateConfidence: 0.9, durationSeconds: 35, violationKind: "no_parking" }) });
    assert.equal(r.status, 202, r.text);
    const v = await M.Violation.findOne({ video: ids.video }).populate("fine").lean();
    assert.equal(v.isTest, false); assert.equal(v.kind, "no_parking"); assert.equal(v.plate, "TN09AB1234");
    assert.equal(v.videoStartSeconds, 12.5);
    assert.equal(v.fine.amount, 500 + 25);                         // base + 1 started minute at rate 25
    assert.deepEqual(v.fine.pricing, { baseAmount: 500, rate: 25, rateUnit: "minute", roundUp: true });
    ids.violation = String(v._id); ids.fine = String(v.fine._id);

    const log = await until(() => M.Log.findOne({ violation: ids.violation }).lean());
    assert.ok(log, "no notification was logged for the registered owner");
    assert.equal(log.status, "mock"); assert.equal(log.channel, "sms"); assert.equal(log.provider, "mock");
    assert.equal(log.to, "+91******3210");                         // masked in the log
    assert.match(log.body, /TN09AB1234/); assert.match(log.body, /Rs 525/);
  });

  test("EVENTS: when the vehicle leaves, the fine is corrected at the rates it was ISSUED with", async () => {
    await api("PUT", "/api/settings", { token: admin.token, body: { baseAmount: 500, rate: 100, rateUnit: "minute", roundUp: true, ruleAmount: 200, bayRulesEnabled: true } });
    await event({ type: "session_ended", jobId: "j1", videoId: ids.video,
      session: sessionPayload({ plate: "TN09AB1234", durationSeconds: 95, violationKind: "no_parking", endedAt: new Date("2026-10-20T10:01:35Z").toISOString(), videoEnd: 107.5 }) });
    const fine = await M.Fine.findById(ids.fine).lean();
    assert.equal(fine.amount, 500 + 2 * 25, "must use the rate the fine was issued with (25), not the new rate (100)");
    const v = await M.Violation.findById(ids.violation).lean();
    assert.equal(v.finalized, true); assert.equal(v.videoEndSeconds, 107.5);
  });

  test("EVENTS: a violation is still recorded when no evidence photo came with it", async () => {
    await event({ type: "session_started", jobId: "j1", videoId: ids.video, session: sessionPayload({ sessionId: "sess-nophoto", trackId: 7, videoStart: 70 }) });
    const r = await event({ type: "violation", jobId: "j1", videoId: ids.video, session: sessionPayload({ sessionId: "sess-nophoto", trackId: 7, durationSeconds: 35, violationKind: "no_parking", videoStart: 70 }) });
    assert.equal(r.status, 202, r.text);
    const v = await M.Violation.findOne({ videoStartSeconds: 70 }).populate("fine").lean();
    assert.ok(v, "violation was lost"); assert.equal(v.snapshotPath, null); assert.ok(v.fine, "fine was lost");
  });

  test("EVENTS: an unregistered or unread plate is logged as skipped, with the reason", async () => {
    await event({ type: "session_started", jobId: "j1", videoId: ids.video, session: sessionPayload({ sessionId: "sess-2", trackId: 2, videoStart: 40 }) });
    await event({ type: "violation", jobId: "j1", videoId: ids.video, session: sessionPayload({ sessionId: "sess-2", trackId: 2, plate: null, durationSeconds: 35, violationKind: "no_parking", videoStart: 40 }) });
    const v2 = await M.Violation.findOne({ videoStartSeconds: 40 }).lean();
    const log = await until(() => M.Log.findOne({ violation: v2._id }).lean());
    assert.equal(log.status, "skipped"); assert.equal(log.error, "plate was not read");
  });

  test("EVENTS: the checkpoint is saved on the video, and never sent back to the browser", async () => {
    const checkpoint = { frame_no: 300, wall_start: "2026-10-20T10:00:00+00:00", sessions: [{ session_id: "sess-9", zone_id: ids.gateZone, vehicle_type: "car", started_at: 12.5, bbox: [1, 2, 30, 40], plate: "TN09AB1234", plate_confidence: 0.9, violation_emitted: true, violation_kind: "no_parking" }] };
    // Progress only ever arrives for a video that is running (events for any other are ignored).
    await M.Video.updateOne({ _id: ids.video }, { $set: { status: "running" } });
    await event({ type: "job_progress", jobId: "j1", videoId: ids.video, progress: 20, vehicles: 5, checkpoint });
    const withCp = await M.Video.findById(ids.video).select("+checkpoint").lean();
    assert.equal(withCp.checkpoint.frame_no, 300); assert.equal(withCp.checkpoint.sessions.length, 1);
    const res = await api("GET", `/api/videos/${ids.video}`, { token: admin.token });
    assert.ok(!("checkpoint" in res.body.video), "checkpoint must not be returned by the API");
    // A resumed job's first heartbeat has no progress: the saved value must survive it.
    await event({ type: "job_progress", jobId: "j2", videoId: ids.video, progress: null });
    assert.equal((await M.Video.findById(ids.video).lean()).progress, 20);
  });

  // ------------------------------------------------------------------ violations lists + evaluation export
  test("VIOLATIONS: the lists say whether the owner was told, and the export has video times for the evaluation script", async () => {
    const day = new Date("2026-10-20T10:00:00Z");
    const all = await api("GET", "/api/violations", { token: admin.token });
    assert.equal(all.status, 200, all.text);
    const mine = all.body.violations.find((v) => v._id === ids.violation);
    assert.equal(mine.notifications.length, 1); assert.equal(mine.notifications[0].status, "mock");
    const exp = await api("GET", `/api/violations/export?video=${ids.video}`, { token: admin.token });
    assert.equal(exp.status, 200, exp.text);
    const row = exp.body.violations.find((v) => v.id === ids.violation);
    assert.deepEqual([row.zone, row.kind, row.plate, row.start_s, row.end_s], ["Gate", "no_parking", "TN09AB1234", 12.5, 107.5]);
    const grouped = await api("GET", "/api/violations/grouped?tz=UTC", { token: admin.token });
    assert.equal(grouped.status, 200, grouped.text);
    assert.ok(grouped.body.days.length >= 1); void day;
  });

  // ------------------------------------------------------------------ what the dashboard pages read
  test("DASHBOARD CONTRACT: every field the pages show is really in the API responses", async () => {
    const sessions = (await api("GET", `/api/videos/${ids.video}/sessions`, { token: admin.token })).body.sessions;
    const s = sessions.find((x) => x.sessionKey === "sess-1");
    assert.equal(typeof s.plateReads, "number");                                        // plate column on the video page
    assert.ok(["reading", "read", "too_small", "unreadable"].includes(s.plateStatus), s.plateStatus);

    const zones = (await api("GET", `/api/zones?video=${ids.video}`, { token: admin.token })).body.zones;
    const lot = zones.find((z) => z.name === "Lot");
    assert.equal(lot.ignoreSpacing, true); assert.equal(lot.minGapRatio, 0.1);          // zone spacing editor

    const settings = (await api("GET", "/api/settings", { token: admin.token })).body;
    assert.equal(settings.settings.bayRulesEnabled, true); assert.ok(settings.updatedAt); // Settings page

    const owners = (await api("GET", "/api/owners", { token: admin.token })).body.owners;
    assert.ok(owners[0].consent.at && owners[0].channels && owners[0].plates.length);   // Owners page

    const logs = (await api("GET", "/api/notifications", { token: admin.token })).body.notifications;
    const l = logs.find((x) => x.status === "mock");
    for (const f of ["plate", "to", "channel", "status", "createdAt", "body"]) assert.ok(l[f] !== undefined, `notification.${f} missing`);

    const entry = (await audit())[0];
    for (const f of ["_id", "action", "actorName", "actorRole", "createdAt", "target", "changes"]) assert.ok(entry[f] !== undefined, `audit.${f} missing`);

    const video = (await api("GET", `/api/videos/${ids.video}`, { token: admin.token })).body.video;
    assert.equal(video.isTest, false);                                                   // TEST badge
  });

  // ------------------------------------------------------------------ audit: fines
  test("AUDIT: paying and cancelling a fine are recorded (cancelling needs an admin and keeps the reason)", async () => {
    const pay = await api("POST", `/api/fines/${ids.fine}/pay`, { token: controller.token });
    assert.equal(pay.status, 200, pay.text);
    const paid = (await audit("&action=fine")).find((e) => e.action === "fine.paid");
    assert.ok(paid); assert.deepEqual(paid.changes.map((c) => [c.field, c.from, c.to]), [["status", "issued", "paid"]]);
    assert.equal(paid.actorName, "Carl Controller");

    const fine2 = await M.Fine.findOne({ _id: { $ne: ids.fine } });
    assert.equal((await api("POST", `/api/fines/${fine2._id}/cancel`, { token: controller.token, body: { reason: "x" } })).status, 403);
    assert.equal((await api("POST", `/api/fines/${fine2._id}/cancel`, { token: admin.token, body: { reason: "driver was loading an ambulance" } })).status, 200);
    const cancelled = (await audit("&action=fine")).find((e) => e.action === "fine.cancelled");
    assert.equal(cancelled.note, "driver was loading an ambulance"); assert.equal(cancelled.actorName, "Asha Admin");
  });

  // ------------------------------------------------------------------ 4. bay switch reaches the detector
  test("SETTINGS: the bay switch and per-zone spacing reach the detector when a job starts", async () => {
    await api("PUT", "/api/settings", { token: admin.token, body: { baseAmount: 500, rate: 25, rateUnit: "minute", roundUp: true, ruleAmount: 200, bayRulesEnabled: false } });
    await M.Video.updateOne({ _id: ids.video }, { $set: { status: "stopped" } });
    const r = await api("POST", `/api/videos/${ids.video}/start`, { token: admin.token });
    assert.equal(r.status, 200, r.text);
    const sent = fake.state.started.at(-1);
    assert.equal(sent.params.bay_rules_enabled, false);
    const lot = sent.zones.find((z) => z.name === "Lot");
    assert.equal(lot.ignore_spacing, true); assert.equal(lot.min_gap_ratio, 0.1);
    assert.equal(sent.zones.find((z) => z.name === "Gate").min_gap_ratio, null);
    assert.equal(sent.resume, undefined, "a normal start must not carry a resume state");
    await M.Video.updateOne({ _id: ids.video }, { $set: { status: "stopped" } });
  });

  // ------------------------------------------------------------------ 8. resume
  async function lostVideo({ checkpoint = true, resumeCount = 0 } = {}) {
    const v = await M.Video.create({ originalName: "lost.mp4", sourceType: "upload", storedName: "lost.mp4", sizeBytes: 1, uploadedBy: admin.id, status: "running", jobId: `lost-${Math.random()}`, resumeCount });
    await M.Zone.create({ name: "Gate", type: "no_parking", points: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }], video: v._id, createdBy: admin.id });
    const session = await M.Session.create({ sessionKey: `s-${v._id}`, video: v._id, trackId: 1, zoneName: "Gate", zoneType: "no_parking", vehicleType: "car", startedAt: new Date(), durationSeconds: 5, status: "active" });
    if (checkpoint) await M.Video.updateOne({ _id: v._id }, { $set: { checkpoint: { frame_no: 450, wall_start: "2026-10-20T10:00:00+00:00", sessions: [] } } });
    return { v, session };
  }

  test("RESUME: a job the detector lost is restarted from its checkpoint, and its parked vehicles stay open", async () => {
    const { v, session } = await lostVideo();
    const startedBefore = fake.state.started.length;
    const res = await api("GET", `/api/videos/${v._id}`, { token: admin.token });
    assert.equal(res.status, 200, res.text);
    assert.equal(fake.state.started.length, startedBefore + 1);
    const sent = fake.state.started.at(-1);
    assert.equal(sent.resume.frame_no, 450); assert.equal(sent.video_id, String(v._id));
    const after = await M.Video.findById(v._id).lean();
    assert.equal(after.status, "queued"); assert.equal(after.resumeCount, 1); assert.notEqual(after.jobId, v.jobId);
    assert.equal((await M.Session.findById(session._id).lean()).status, "active", "resuming must not close the open sessions");
  });

  test("RESUME: without a checkpoint it fails cleanly and closes the open sessions", async () => {
    const { v, session } = await lostVideo({ checkpoint: false });
    await api("GET", `/api/videos/${v._id}`, { token: admin.token });
    const after = await M.Video.findById(v._id).lean();
    assert.equal(after.status, "failed"); assert.match(after.error, /interrupted/);
    assert.equal((await M.Session.findById(session._id).lean()).status, "closed");
  });

  test("RESUME: a job that keeps getting lost is not restarted forever", async () => {
    const { v } = await lostVideo({ resumeCount: 3 });
    const startedBefore = fake.state.started.length;
    await api("GET", `/api/videos/${v._id}`, { token: admin.token });
    assert.equal(fake.state.started.length, startedBefore);
    assert.equal((await M.Video.findById(v._id).lean()).status, "failed");
  });

  test("RESUME: several simultaneous checks resume the job exactly once", async () => {
    const { v } = await lostVideo();
    const startedBefore = fake.state.started.length;
    await Promise.all([1, 2, 3, 4].map(() => api("GET", `/api/videos/${v._id}`, { token: admin.token })));
    assert.equal(fake.state.started.length, startedBefore + 1);
    assert.equal((await M.Video.findById(v._id).lean()).status, "queued");
  });

  // ------------------------------------------------------------------ pause / resume
  async function runningVideo({ name = "pausable.mp4" } = {}) {
    const jobId = `pj-${Math.random().toString(36).slice(2)}`;
    fake.state.known.add(jobId);
    const v = await M.Video.create({ originalName: name, sourceType: "upload", storedName: name, sizeBytes: 1, uploadedBy: admin.id, status: "running", progress: 40, jobId });
    await M.Zone.create({ name: "Gate", type: "no_parking", points: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }], video: v._id, createdBy: admin.id });
    const session = await M.Session.create({ sessionKey: `ps-${v._id}`, video: v._id, trackId: 1, zoneName: "Gate", zoneType: "no_parking", vehicleType: "car", startedAt: new Date(), durationSeconds: 5, status: "active" });
    return { v, jobId, session };
  }
  const CP = (n) => ({ frame_no: n, wall_start: "2026-10-20T10:00:00+00:00", sessions: [{ session_id: "keep-me", zone_id: "z", vehicle_type: "car", started_at: 3, bbox: [1, 2, 30, 40] }] });
  const pause = (id, who = controller) => api("POST", `/api/videos/${id}/pause`, { token: who.token });
  const resume = (id, who = controller) => api("POST", `/api/videos/${id}/resume`, { token: who.token });

  test("PAUSE: pausing keeps the parked vehicles open and saves the detector's own checkpoint", async () => {
    const { v, jobId, session } = await runningVideo();
    fake.state.nextCheckpoint = CP(777);
    const r = await pause(v._id);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.video.status, "paused");
    assert.ok(!("checkpoint" in r.body.video), "checkpoint must not be sent to the browser");
    assert.deepEqual(fake.state.pausedCalls.filter((j) => j === jobId), [jobId]);
    const saved = await M.Video.findById(v._id).select("+checkpoint").lean();
    assert.equal(saved.checkpoint.frame_no, 777); assert.equal(saved.checkpoint.sessions[0].session_id, "keep-me");
    assert.equal((await M.Session.findById(session._id).lean()).status, "active", "pausing must NOT close the parked vehicles");
    ids.paused = String(v._id);
  });

  test("PAUSE: a progress event that was already on its way cannot switch a paused video back to running", async () => {
    const v = await M.Video.findById(ids.paused).lean();
    await event({ type: "job_progress", jobId: v.jobId, videoId: ids.paused, progress: 55, vehicles: 3 });
    const after = await M.Video.findById(ids.paused).lean();
    assert.equal(after.status, "paused"); assert.equal(after.progress, 40);
  });

  test("PAUSE: a paused video cannot be started from scratch by accident, and the monitor leaves it alone", async () => {
    const r = await api("POST", `/api/videos/${ids.paused}/start`, { token: controller.token });
    assert.equal(r.status, 409); assert.match(r.body.error, /paused/i);
    const startedBefore = fake.state.started.length;
    await api("GET", `/api/videos/${ids.paused}`, { token: controller.token });   // runs the lost-job check
    assert.equal((await M.Video.findById(ids.paused).lean()).status, "paused", "a paused video is not a lost job");
    assert.equal(fake.state.started.length, startedBefore);
  });

  test("PAUSE: only a running video can be paused", async () => {
    assert.equal((await pause(ids.paused)).status, 409);                          // already paused
    const stopped = await M.Video.create({ originalName: "s.mp4", sourceType: "upload", storedName: "s.mp4", sizeBytes: 1, uploadedBy: admin.id, status: "stopped" });
    assert.equal((await pause(stopped._id)).status, 409);
    assert.equal((await pause("64b64b64b64b64b64b64b64b")).status, 404);
  });

  test("RESUME: continues from the saved position, and is not counted as an automatic restart", async () => {
    const before = await M.Video.findById(ids.paused).lean();
    const startedBefore = fake.state.started.length;
    const r = await resume(ids.paused);
    assert.equal(r.status, 200, r.text);
    assert.equal(fake.state.started.length, startedBefore + 1);
    const sent = fake.state.started.at(-1);
    assert.equal(sent.resume.frame_no, 777); assert.equal(sent.resume.sessions[0].session_id, "keep-me");
    const after = await M.Video.findById(ids.paused).lean();
    assert.equal(after.status, "queued"); assert.notEqual(after.jobId, before.jobId);
    assert.equal(after.resumeCount ?? 0, before.resumeCount ?? 0, "a person clicking Resume is not a crash");
    assert.equal((await resume(ids.paused)).status, 409);                          // not paused any more
  });

  test("RESUME: while the detector is busy with another video, it says so and stays paused", async () => {
    const { v } = await runningVideo({ name: "busy.mp4" });
    await pause(v._id);
    fake.state.rejectStart = true;
    const r = await resume(v._id);
    fake.state.rejectStart = false;
    assert.equal(r.status, 409); assert.match(r.body.error, /another video/i); assert.match(r.body.error, /pause or stop/i);
    assert.equal((await M.Video.findById(v._id).lean()).status, "paused", "a refused resume must not lose the pause");
    assert.equal((await resume(v._id)).status, 200, "and it works once the detector is free");
  });

  test("WORKFLOW: pause one video, work on another, then come back to the first", async () => {
    const a = await runningVideo({ name: "A.mp4" });
    fake.state.nextCheckpoint = CP(300);
    assert.equal((await pause(a.v._id)).status, 200);                              // A is paused, detector is free
    const b = await M.Video.create({ originalName: "B.mp4", sourceType: "upload", storedName: "B.mp4", sizeBytes: 1, uploadedBy: admin.id, status: "uploaded" });
    await M.Zone.create({ name: "Gate", type: "no_parking", points: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }], video: b._id, createdBy: admin.id });
    assert.equal((await api("POST", `/api/videos/${b._id}/start`, { token: controller.token })).status, 200);   // B runs
    assert.equal((await M.Video.findById(b._id).lean()).status, "queued");
    const bJob = (await M.Video.findById(b._id).lean()).jobId; fake.state.known.add(bJob);
    fake.state.nextCheckpoint = CP(50);
    assert.equal((await pause(b._id)).status, 200);                                // B paused
    assert.equal((await resume(a.v._id)).status, 200);                             // back to A
    assert.equal(fake.state.started.at(-1).resume.frame_no, 300, "A must carry on from ITS position, not B's");
    assert.equal((await M.Video.findById(b._id).lean()).status, "paused");         // B is untouched, waiting
    assert.equal((await M.Session.findById(a.session._id).lean()).status, "active");
  });

  test("PAUSE: a job the detector lost can still be paused if progress was saved, and cannot if not", async () => {
    const lost = await M.Video.create({ originalName: "l.mp4", sourceType: "upload", storedName: "l.mp4", sizeBytes: 1, uploadedBy: admin.id, status: "running", jobId: "gone-forever" });
    await M.Zone.create({ name: "Gate", type: "no_parking", points: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }], video: lost._id, createdBy: admin.id });
    let r = await pause(lost._id);
    assert.equal(r.status, 409); assert.match(r.body.error, /lost this job/);
    await M.Video.updateOne({ _id: lost._id }, { $set: { checkpoint: CP(90) } });
    r = await pause(lost._id);
    assert.equal(r.status, 200, r.text); assert.equal(r.body.video.status, "paused");
  });

  test("STOP: stopping a paused video closes its parked vehicles and marks it stopped", async () => {
    const { v, session } = await runningVideo({ name: "tostop.mp4" });
    await pause(v._id);
    const r = await api("POST", `/api/videos/${v._id}/stop`, { token: controller.token });
    assert.equal(r.status, 200, r.text);
    assert.equal((await M.Video.findById(v._id).lean()).status, "stopped");
    assert.equal((await M.Session.findById(session._id).lean()).status, "closed");
    assert.equal((await resume(v._id)).status, 409);                               // nothing left to resume
  });

  test("PAUSE: a paused video does not block deleting test data, and a running one still does", async () => {
    const { v } = await runningVideo({ name: "t2.mp4" });
    await M.Video.updateOne({ _id: v._id }, { $set: { isTest: true } });
    assert.equal((await api("DELETE", "/api/test-data", { token: admin.token })).status, 409);   // running: refused
    await pause(v._id);
    assert.equal((await api("DELETE", "/api/test-data", { token: admin.token })).status, 200);   // paused: fine
  });

  // ------------------------------------------------------------------ 5. test data
  test("TEST DATA: flagging a video flags its violations; a one-click delete removes only test records and their files", async () => {
    // a video with a violation and real files on disk
    const tv = await M.Video.create({ originalName: "t.mp4", sourceType: "upload", storedName: "t-test.mp4", sizeBytes: 1, uploadedBy: admin.id, status: "stopped" });
    const zone = await M.Zone.create({ name: "Gate", type: "no_parking", points: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }], video: tv._id, createdBy: admin.id });
    await event({ type: "session_started", jobId: "t", videoId: String(tv._id), session: sessionPayload({ sessionId: "t-sess", zoneId: String(zone._id), videoStart: 1 }) });
    await event({ type: "violation", jobId: "t", videoId: String(tv._id), session: sessionPayload({ sessionId: "t-sess", zoneId: String(zone._id), plate: null, durationSeconds: 40, violationKind: "no_parking", videoStart: 1 }) });
    const vio = await M.Violation.findOne({ video: tv._id });
    assert.equal(vio.isTest, false);
    const snap = path.join(UPLOADS, "snapshots", "test-snap.jpg"), vid = path.join(UPLOADS, "videos", "t-test.mp4");
    fs.writeFileSync(snap, "x"); fs.writeFileSync(vid, "x");
    await M.Violation.findByIdAndUpdate(vio._id, { snapshotPath: "uploads/snapshots/test-snap.jpg" });

    // flag it as a test video
    assert.equal((await api("PATCH", `/api/videos/${tv._id}`, { token: controller.token, body: { isTest: "yes" } })).status, 400);
    const flagged = await api("PATCH", `/api/videos/${tv._id}`, { token: controller.token, body: { isTest: true } });
    assert.equal(flagged.status, 200, flagged.text);
    assert.equal((await M.Violation.findById(vio._id).lean()).isTest, true);

    // the summary tells the truth, and only admins may look or delete
    assert.equal((await api("GET", "/api/test-data/summary", { token: controller.token })).status, 403);
    const sum = (await api("GET", "/api/test-data/summary", { token: admin.token })).body.summary;
    assert.deepEqual([sum.videos, sum.violations, sum.fines], [1, 1, 1]);

    // refuses while a test video is still running
    await M.Video.updateOne({ _id: tv._id }, { $set: { status: "running" } });
    assert.equal((await api("DELETE", "/api/test-data", { token: admin.token })).status, 409);
    await M.Video.updateOne({ _id: tv._id }, { $set: { status: "stopped" } });

    const keepViolations = await M.Violation.countDocuments({ isTest: false });
    const del = await api("DELETE", "/api/test-data", { token: admin.token });
    assert.equal(del.status, 200, del.text);
    assert.deepEqual([del.body.removed.videos, del.body.removed.violations, del.body.removed.fines], [1, 1, 1]);
    assert.equal(await M.Video.countDocuments({ isTest: true }), 0);
    assert.equal(await M.Violation.countDocuments({ isTest: false }), keepViolations, "real violations must be untouched");
    assert.equal(fs.existsSync(snap), false, "evidence photo not deleted"); assert.equal(fs.existsSync(vid), false, "video file not deleted");
    assert.ok((await audit("&action=test-data")).find((e) => e.action === "test-data.delete"));
  });

  test("TEST DATA: the temporary test-image upload is flagged automatically", async () => {
    const form = new FormData();
    // a 1x1 PNG
    form.append("image", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==", "base64")], { type: "image/png" }), "car.png");
    const res = await fetch(`${base}/api/videos/image`, { method: "POST", headers: { authorization: `Bearer ${admin.token}` }, body: form });
    const text = await res.text();
    assert.equal(res.status, 201, text);
    const { video } = JSON.parse(text);
    assert.equal(video.isTest, true); assert.equal(video.sourceType, "image");
    const sum = (await api("GET", "/api/test-data/summary", { token: admin.token })).body.summary;
    assert.equal(sum.videos, 1);
    await api("DELETE", "/api/test-data", { token: admin.token }); // clean up the uploaded file too
  });

  // ------------------------------------------------------------------ audit + owners wrap-up
  test("OWNERS: editing and deleting an owner are audited, and deleting removes the personal data", async () => {
    const upd = await api("PUT", `/api/owners/${ids.owner}`, { token: admin.token, body: { phone: "9000000001" } });
    assert.equal(upd.status, 200, upd.text); assert.equal(upd.body.owner.phone, "+919000000001");
    assert.equal((await api("DELETE", `/api/owners/${ids.owner}`, { token: admin.token })).status, 204);
    assert.equal(await M.Owner.countDocuments(), 0);
    const actions = (await audit("&action=owner")).map((e) => e.action).sort();
    assert.deepEqual(actions, ["owner.create", "owner.delete", "owner.update"]);
  });

  test("AUDIT: the log is newest first, and can be filtered by area", async () => {
    const all = await audit();
    for (let i = 1; i < all.length; i++) assert.ok(new Date(all[i - 1].createdAt) >= new Date(all[i].createdAt), "not newest first");
    const settingsOnly = await audit("&action=settings");
    assert.ok(settingsOnly.length >= 2 && settingsOnly.every((e) => e.action.startsWith("settings")));
    assert.equal((await api("GET", "/api/audit?before=notadate", { token: admin.token })).status, 400);
  });
});
