import { normalisePhone, normalisePlate } from "./identity.js";

const bad = (message) => Object.assign(new Error(message), { status: 400 });

/** "tn09ab1234, TN 10 CD 5678" or an array -> ["TN09AB1234", "TN10CD5678"] (clean, unique). */
export function parsePlates(input) {
  const list = Array.isArray(input) ? input : String(input ?? "").split(/[,;\n]+/);
  return [...new Set(list.map(normalisePlate).filter(Boolean))];
}

/**
 * Checks what an admin typed into the owner form. `partial` (for edits) only checks the
 * fields that were sent. Registering an owner REQUIRES consent - there is no way around it.
 */
export function validateOwnerInput(body = {}, { defaultCountryCode = "+91", partial = false } = {}) {
  const out = {};
  if (!partial || body.name !== undefined) {
    const name = String(body.name ?? "").trim();
    if (name.length < 2) throw bad("Enter the owner's name");
    out.name = name;
  }
  if (!partial || body.phone !== undefined) {
    const phone = normalisePhone(body.phone, defaultCountryCode);
    if (!phone) throw bad("Enter a valid mobile number (with or without the country code)");
    out.phone = phone;
  }
  if (!partial || body.plates !== undefined) {
    const plates = parsePlates(body.plates);
    if (!plates.length) throw bad("Enter at least one number plate");
    const odd = plates.find((p) => p.length < 4 || p.length > 12);
    if (odd) throw bad(`"${odd}" does not look like a number plate`);
    out.plates = plates;
  }
  if (!partial || body.channels !== undefined) {
    const c = body.channels ?? {};
    out.channels = { sms: c.sms !== false, whatsapp: c.whatsapp === true };
    if (!out.channels.sms && !out.channels.whatsapp) throw bad("Switch on at least one way to contact the owner (SMS or WhatsApp)");
  }
  if (!partial) {
    if (body.consentGiven !== true) throw bad("The owner's consent to be contacted is required");
  }
  if (body.consentNote !== undefined) out.consentNote = String(body.consentNote).slice(0, 300);
  return out;
}
