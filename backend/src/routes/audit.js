import { Router } from "express";
import { AuditLog } from "../models/AuditLog.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const auditRouter = Router();
auditRouter.use(requireAuth, requireRole("admin"));

// Newest first. ?action=settings matches "settings.*"; ?before=<ISO date> pages backwards.
auditRouter.get("/", async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const filter = {};
    if (req.query.action) {
      const escaped = String(req.query.action).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.action = new RegExp(`^${escaped}`);
    }
    if (req.query.before) {
      const before = new Date(req.query.before);
      if (Number.isNaN(before.getTime())) return res.status(400).json({ error: "before must be a date" });
      filter.createdAt = { $lt: before };
    }
    res.json({ entries: await AuditLog.find(filter).sort({ createdAt: -1 }).limit(limit).lean() });
  } catch (err) { next(err); }
});
