import { AuditLog } from "../models/AuditLog.js";

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The fields that differ between two objects, as [{field, from, to}]. */
export function diffFields(before = {}, after = {}, fields) {
  return fields
    .filter((f) => !same(before[f], after[f]))
    .map((f) => ({ field: f, from: before[f] ?? null, to: after[f] ?? null }));
}

/**
 * Writes one audit record. It must never break the action being audited, so a failure
 * to write is logged and swallowed - but only after the real change has succeeded.
 */
export async function recordAudit(user, action, target = {}, changes = [], note = "") {
  try {
    return await AuditLog.create({
      actor: user?.sub, actorName: user?.name, actorRole: user?.role,
      action, target, changes, note,
    });
  } catch (err) {
    console.error("[audit] could not write audit record:", err.message);
    return null;
  }
}
