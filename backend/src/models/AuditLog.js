import mongoose from "mongoose";

// Who changed what, and when - for settings, fines, zones, owners and test-data cleanup.
// Append-only: nothing in the app edits or deletes these records.
const auditSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    actorName: String,
    actorRole: String,
    action: { type: String, required: true }, // e.g. "settings.update", "fine.paid", "owner.delete"
    target: {
      type: { type: String },  // "settings" | "fine" | "zone" | "owner" | "video" | "test-data"
      id: String,
      label: String,           // human-readable, kept so the log still reads well after a delete
    },
    changes: [{ _id: false, field: String, from: mongoose.Schema.Types.Mixed, to: mongoose.Schema.Types.Mixed }],
    note: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
auditSchema.index({ createdAt: -1 });

export const AuditLog = mongoose.model("AuditLog", auditSchema);
