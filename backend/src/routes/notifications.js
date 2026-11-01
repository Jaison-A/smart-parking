import { Router } from "express";
import { NotificationLog } from "../models/NotificationLog.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth, requireRole("admin"));

// The message log: every message sent to an owner, or skipped (with the reason).
notificationsRouter.get("/", async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    res.json({ notifications: await NotificationLog.find().sort({ createdAt: -1 }).limit(limit).lean() });
  } catch (err) { next(err); }
});
