import test from "node:test";
import assert from "node:assert/strict";
import { normalisePlate, normalisePhone, maskPhone } from "../src/services/identity.js";
import { parsePlates, validateOwnerInput } from "../src/services/ownerInput.js";

test("plates are cleaned to upper-case letters and digits", () => {
  assert.equal(normalisePlate("tn 09-ab 1234"), "TN09AB1234");
  assert.equal(normalisePlate(null), "");
});

test("phone numbers are turned into E.164, adding the default country code", () => {
  assert.equal(normalisePhone("98765 43210"), "+919876543210");
  assert.equal(normalisePhone("098765-43210"), "+919876543210");   // leading 0 dropped
  assert.equal(normalisePhone("+91 98765 43210"), "+919876543210");
  assert.equal(normalisePhone("919876543210"), "+919876543210");   // code present, "+" missing
  assert.equal(normalisePhone("0044 7911 123456"), "+447911123456");
  assert.equal(normalisePhone("9876543210", "+44"), "+449876543210");
});

test("things that cannot be phone numbers are rejected", () => {
  for (const bad of ["", "abc", "12345", "+0123456789", "98765x3210", null]) {
    assert.equal(normalisePhone(bad), null, String(bad));
  }
});

test("phone numbers are masked for the message log", () => {
  assert.equal(maskPhone("+919876543210"), "+91******3210");
});

test("a list of plates is split, cleaned and de-duplicated", () => {
  assert.deepEqual(parsePlates("tn09ab1234, TN 10 CD 5678; tn09ab1234"), ["TN09AB1234", "TN10CD5678"]);
  assert.deepEqual(parsePlates(["ka01 aa 1111"]), ["KA01AA1111"]);
});

const good = { name: "Asha", phone: "9876543210", plates: "TN09AB1234", consentGiven: true };

test("a valid owner form is accepted and cleaned", () => {
  const v = validateOwnerInput(good);
  assert.equal(v.phone, "+919876543210");
  assert.deepEqual(v.plates, ["TN09AB1234"]);
  assert.deepEqual(v.channels, { sms: true, whatsapp: false });
});

test("an owner cannot be registered without consent", () => {
  for (const consentGiven of [false, undefined, "true", 1]) {
    assert.throws(() => validateOwnerInput({ ...good, consentGiven }), (e) => e.status === 400 && /consent/i.test(e.message));
  }
});

test("bad owner details are rejected with a clear message", () => {
  assert.throws(() => validateOwnerInput({ ...good, name: "A" }), /name/i);
  assert.throws(() => validateOwnerInput({ ...good, phone: "123" }), /mobile/i);
  assert.throws(() => validateOwnerInput({ ...good, plates: "" }), /plate/i);
  assert.throws(() => validateOwnerInput({ ...good, plates: "AB" }), /number plate/i);
  assert.throws(() => validateOwnerInput({ ...good, channels: { sms: false, whatsapp: false } }), /at least one way/i);
});

test("an edit only checks the fields that were sent, and needs no consent again", () => {
  assert.deepEqual(validateOwnerInput({ phone: "9000000001" }, { partial: true }), { phone: "+919000000001" });
  assert.throws(() => validateOwnerInput({ phone: "bad" }, { partial: true }), /mobile/i);
});
