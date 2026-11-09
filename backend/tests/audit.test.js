import test from "node:test";
import assert from "node:assert/strict";
import { diffFields, recordAudit } from "../src/services/auditService.js";

test("diffFields lists only what changed, with before and after", () => {
  const before = { rate: 20, rateUnit: "minute", roundUp: true };
  const after = { rate: 60, rateUnit: "hour", roundUp: true };
  assert.deepEqual(diffFields(before, after, ["rate", "rateUnit", "roundUp"]), [
    { field: "rate", from: 20, to: 60 },
    { field: "rateUnit", from: "minute", to: "hour" },
  ]);
});

test("nothing changed means an empty list", () => {
  assert.deepEqual(diffFields({ a: 1 }, { a: 1 }, ["a"]), []);
});

test("arrays and missing values compare by content", () => {
  assert.deepEqual(diffFields({ plates: ["A"] }, { plates: ["A"] }, ["plates"]), []);
  assert.deepEqual(diffFields({}, { plates: ["A"] }, ["plates"]), [{ field: "plates", from: null, to: ["A"] }]);
});

test("a failure to write the audit record never breaks the action being audited", async () => {
  // No database is connected in this test, so the write cannot succeed - it must not throw.
  const result = await recordAudit({ sub: "507f1f77bcf86cd799439011", name: "A", role: "admin" }, "x.y");
  assert.equal(result, null);
});
