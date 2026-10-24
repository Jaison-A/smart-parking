import { Router } from "express";
import { Settings } from "../models/Settings.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { getFineSettings, saveFineSettings } from "../services/settingsService.js";

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

settingsRouter.get("/", async (_req, res, next) => {
  try {
    const doc = await Settings.findOne({ key: "global" }).select("updatedAt").lean();
    res.json({ settings: await getFineSettings(), updatedAt: doc?.updatedAt ?? null });
  } catch (err) { next(err); }
});

// Changes apply to fines issued from now on; existing fines keep the rates they were issued with.
settingsRouter.put("/", requireRole("admin"), async (req, res, next) => {
  try {
    res.json({ settings: await saveFineSettings(req.body, req.user.sub) });
  } catch (err) { next(err); }
});
