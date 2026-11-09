import test from "node:test";
import assert from "node:assert/strict";
import { buildFineMessage, mockProvider, twilioProvider, notifyOwnerOfFine } from "../src/services/ownerMessages.js";

const violation = { _id: "v1", plate: "TN09AB1234", zoneName: "Gate", kind: "no_parking" };
const fine = { _id: "f1", amount: 750 };
const owner = { _id: "o1", phone: "+919876543210", channels: { sms: true, whatsapp: false } };

function deps(over = {}) {
  const logs = [], sent = [];
  return {
    logs, sent,
    d: {
      findOwner: async () => owner,
      writeLog: async (e) => { logs.push(e); return e; },
      provider: { name: "mock", send: async (m) => { sent.push(m); return { status: "mock", id: "m1" }; } },
      now: () => new Date("2026-10-24T10:00:00Z"),
      ...over,
    },
  };
}

test("the message says what, where and how much", () => {
  const text = buildFineMessage({ plate: "TN09AB1234", zoneName: "Gate", kind: "no_parking", amount: 750, when: new Date("2026-10-24T10:00:00Z") });
  assert.match(text, /TN09AB1234/); assert.match(text, /no-parking area/); assert.match(text, /"Gate"/); assert.match(text, /Rs 750/);
});

test("each kind of violation gets its own wording", () => {
  assert.match(buildFineMessage({ plate: "X", zoneName: "Z", kind: "spacing", amount: 1 }), /too close/);
  assert.match(buildFineMessage({ plate: "X", zoneName: "Z", kind: "bay_occupied", amount: 1 }), /already taken/);
});

test("a registered owner is messaged and the attempt is logged with a masked number", async () => {
  const { logs, sent, d } = deps();
  await notifyOwnerOfFine(violation, fine, d);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "+919876543210");               // the provider gets the real number
  assert.equal(logs.length, 1);
  assert.equal(logs[0].status, "mock");
  assert.equal(logs[0].to, "+91******3210");               // the log never stores it in full
  assert.equal(logs[0].channel, "sms");
});

test("both channels are used when the owner has both switched on", async () => {
  const { logs, sent, d } = deps({ findOwner: async () => ({ ...owner, channels: { sms: true, whatsapp: true } }) });
  await notifyOwnerOfFine(violation, fine, d);
  assert.deepEqual(sent.map((m) => m.channel), ["sms", "whatsapp"]);
  assert.equal(logs.length, 2);
});

test("an unread plate is skipped, and the log says why", async () => {
  const { logs, sent, d } = deps();
  await notifyOwnerOfFine({ ...violation, plate: null }, fine, d);
  assert.equal(sent.length, 0);
  assert.deepEqual([logs[0].status, logs[0].error], ["skipped", "plate was not read"]);
});

test("an unregistered plate is skipped, and the log says why", async () => {
  const { logs, sent, d } = deps({ findOwner: async () => null });
  await notifyOwnerOfFine(violation, fine, d);
  assert.equal(sent.length, 0);
  assert.match(logs[0].error, /no registered owner/);
});

test("a provider failure is logged as failed and never thrown", async () => {
  const { logs, d } = deps({ provider: { name: "twilio", send: async () => { throw new Error("rejected"); } } });
  await assert.doesNotReject(notifyOwnerOfFine(violation, fine, d));
  assert.deepEqual([logs[0].status, logs[0].error], ["failed", "rejected"]);
});

test("the plate is matched in its clean form", async () => {
  let asked;
  const { d } = deps({ findOwner: async (p) => { asked = p; return null; } });
  await notifyOwnerOfFine({ ...violation, plate: "tn 09 ab 1234" }, fine, d);
  assert.equal(asked, "TN09AB1234");
});

test("the mock provider contacts nobody and says so", async () => {
  assert.equal((await mockProvider.send({})).status, "mock");
});

test("Twilio refuses to run when it is not configured", async () => {
  await assert.rejects(twilioProvider.send({ to: "+919876543210", body: "x", channel: "sms" }), /not configured/);
});

// The real sender's request, checked against a stand-in for the network (nothing is called).
import { env } from "../src/config/env.js";

test("Twilio: builds the SMS and WhatsApp requests correctly", async () => {
  const saved = { fetch: globalThis.fetch, ...env };
  Object.assign(env, { twilioAccountSid: "AC123", twilioAuthToken: "tok", twilioSmsFrom: "+15550001111", twilioWhatsappFrom: "+14155238886" });
  const calls = [];
  globalThis.fetch = async (url, opts) => { calls.push({ url, opts }); return { ok: true, json: async () => ({ sid: "SM1" }) }; };
  try {
    const sms = await twilioProvider.send({ to: "+919876543210", body: "hello", channel: "sms" });
    const wa = await twilioProvider.send({ to: "+919876543210", body: "hello", channel: "whatsapp" });
    assert.deepEqual([sms, wa], [{ status: "sent", id: "SM1" }, { status: "sent", id: "SM1" }]);

    assert.equal(calls[0].url, "https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json");
    assert.equal(calls[0].opts.headers.Authorization, `Basic ${Buffer.from("AC123:tok").toString("base64")}`);
    const smsBody = Object.fromEntries(calls[0].opts.body);
    assert.deepEqual(smsBody, { To: "+919876543210", From: "+15550001111", Body: "hello" });
    const waBody = Object.fromEntries(calls[1].opts.body);
    assert.deepEqual(waBody, { To: "whatsapp:+919876543210", From: "whatsapp:+14155238886", Body: "hello" });
  } finally {
    globalThis.fetch = saved.fetch;
    Object.assign(env, { twilioAccountSid: "", twilioAuthToken: "", twilioSmsFrom: "", twilioWhatsappFrom: "" });
  }
});

test("Twilio: an error response becomes a thrown error with Twilio's message", async () => {
  const saved = globalThis.fetch;
  Object.assign(env, { twilioAccountSid: "AC1", twilioAuthToken: "t", twilioSmsFrom: "+1555" });
  globalThis.fetch = async () => ({ ok: false, status: 400, json: async () => ({ message: "invalid To number" }) });
  try {
    await assert.rejects(twilioProvider.send({ to: "+1", body: "x", channel: "sms" }), /invalid To number/);
  } finally {
    globalThis.fetch = saved;
    Object.assign(env, { twilioAccountSid: "", twilioAuthToken: "", twilioSmsFrom: "" });
  }
});
