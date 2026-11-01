import { env } from "../config/env.js";
import { NotificationLog } from "../models/NotificationLog.js";
import { Owner } from "../models/Owner.js";
import { maskPhone, normalisePlate } from "./identity.js";

const REASON = {
  no_parking: "parked in a no-parking area",
  spacing: "parked too close to another vehicle",
  bay_straddle: "not parked inside a single bay",
  bay_occupied: "parked in a bay that was already taken",
};

/** The text sent to the owner. Plain and factual: what, where, when, how much. */
export function buildFineMessage({ plate, zoneName, kind, amount, when = new Date() }) {
  const reason = REASON[kind] || "parked against the parking rules";
  const date = new Date(when).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  return `Curbside parking notice: vehicle ${plate} was recorded ${reason} at "${zoneName}" on ${date}. ` +
    `Fine: Rs ${amount}. Please contact the parking office to pay or to dispute this.`;
}

// ------------------------------------------------------------------ providers
/** Demo sender: records what WOULD have been sent, contacts nobody. */
export const mockProvider = {
  name: "mock",
  async send() {
    return { status: "mock", id: `mock-${Date.now()}` };
  },
};

/**
 * Real sender through Twilio's REST API (SMS and WhatsApp). Needs TWILIO_* settings.
 * NOTE: not exercised against the live service in this project's tests - verify with a
 * test number first. In India, SMS also needs DLT sender-ID and template registration.
 */
export const twilioProvider = {
  name: "twilio",
  async send({ to, body, channel }) {
    const { twilioAccountSid: sid, twilioAuthToken: token } = env;
    let from = channel === "whatsapp" ? env.twilioWhatsappFrom : env.twilioSmsFrom;
    if (!sid || !token || !from) {
      throw new Error(`Twilio is not configured for ${channel} (set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and the FROM number)`);
    }
    if (channel === "whatsapp") {
      from = from.startsWith("whatsapp:") ? from : `whatsapp:${from}`;
      to = `whatsapp:${to}`;
    }
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `Twilio returned ${res.status}`);
    return { status: "sent", id: data.sid };
  },
};

export function getProvider(name = env.notifyProvider) {
  return name === "twilio" ? twilioProvider : mockProvider;
}

// ------------------------------------------------------------------ the main flow
const realDeps = () => ({
  findOwner: (plate) => Owner.findOne({ plates: plate }).lean(),
  writeLog: (entry) => NotificationLog.create(entry),
  provider: getProvider(),
  now: () => new Date(),
});

/**
 * After a fine is issued: tell the registered owner, if there is one. Every outcome is
 * logged - including "nobody to tell" and why. Never throws: a messaging problem must
 * not stop the violation itself from being recorded.
 */
export async function notifyOwnerOfFine(violation, fine, deps = {}) {
  const d = { ...realDeps(), ...deps };
  const base = { violation: violation._id, fine: fine?._id, plate: violation.plate || null };
  const logs = [];
  const log = async (entry) => { try { logs.push(await d.writeLog({ ...base, ...entry })); } catch (e) { console.error("[notify] log failed:", e.message); } };

  try {
    const plate = normalisePlate(violation.plate);
    if (!plate) { await log({ status: "skipped", error: "plate was not read", provider: d.provider.name }); return logs; }

    const owner = await d.findOwner(plate);
    if (!owner) { await log({ status: "skipped", error: "no registered owner for this plate", provider: d.provider.name }); return logs; }

    const channels = ["sms", "whatsapp"].filter((c) => owner.channels?.[c]);
    if (!channels.length) { await log({ status: "skipped", owner: owner._id, error: "owner has no channel switched on", provider: d.provider.name }); return logs; }

    const body = buildFineMessage({
      plate, zoneName: violation.zoneName, kind: violation.kind, amount: fine?.amount, when: d.now(),
    });
    for (const channel of channels) {
      const entry = { owner: owner._id, channel, to: maskPhone(owner.phone), body, provider: d.provider.name };
      try {
        const sent = await d.provider.send({ to: owner.phone, body, channel });
        await log({ ...entry, status: sent.status, providerId: sent.id });
      } catch (err) {
        await log({ ...entry, status: "failed", error: err.message });
      }
    }
  } catch (err) {
    console.error("[notify] unexpected error:", err.message);
  }
  return logs;
}
