import { Router } from "express";
import { Settings } from "../models/Settings.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { getFineSettings, saveFineSettings, SETTING_FIELDS } from "../services/settingsService.js";
import { recordAudit, diffFields } from "../services/auditService.js";

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
    const before = await getFineSettings();
    const after = await saveFineSettings(req.body, req.user.sub);
    const changes = diffFields(before, after, SETTING_FIELDS);
    if (changes.length) {
      await recordAudit(req.user, "settings.update", { type: "settings", label: "Fine and rule settings" }, changes);
    }
    res.json({ settings: after });
  } catch (err) { next(err); }
});
