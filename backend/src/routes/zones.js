import { Router } from "express";
import { Zone } from "../models/Zone.js";
import { Video } from "../models/Video.js";
import { requireAuth } from "../middleware/auth.js";
import { recordAudit, diffFields } from "../services/auditService.js";

export const zonesRouter = Router();
zonesRouter.use(requireAuth);

zonesRouter.get("/", async (req, res, next) => {
  try {
    const filter = req.query.video ? { video: req.query.video } : {};
    res.json({ zones: await Zone.find(filter).sort({ createdAt: 1 }) });
  } catch (err) { next(err); }
});

zonesRouter.post("/", async (req, res, next) => {
  try {
    const { name, type, points, video } = req.body;
    if (!name || !["parking", "no_parking", "bay"].includes(type) || !Array.isArray(points) || points.length < 3) {
      return res.status(400).json({ error: "name, type (parking|no_parking|bay) and 3+ points are required" });
    }
    if (!(await Video.exists({ _id: video }))) {
      return res.status(404).json({ error: "Video not found" });
    }
    const zone = await Zone.create({ name, type, points, video, createdBy: req.user.sub });
    res.status(201).json({ zone });
  } catch (err) { next(err); }
});

// Per-zone spacing rule: gap ratio (null = detector default, 0 = no check) and an "ignore" switch.
zonesRouter.patch("/:id", async (req, res, next) => {
  try {
    const { ignoreSpacing, minGapRatio, name } = req.body ?? {};
    const update = {};
    if (ignoreSpacing !== undefined) {
      if (typeof ignoreSpacing !== "boolean") return res.status(400).json({ error: "ignoreSpacing must be true or false" });
      update.ignoreSpacing = ignoreSpacing;
    }
    if (minGapRatio !== undefined) {
      if (minGapRatio !== null && !(Number.isFinite(Number(minGapRatio)) && Number(minGapRatio) >= 0 && Number(minGapRatio) <= 2)) {
        return res.status(400).json({ error: "minGapRatio must be between 0 and 2 (e.g. 0.25 = 25% of the vehicle width), or empty for the default" });
      }
      update.minGapRatio = minGapRatio === null ? null : Number(minGapRatio);
    }
    if (name !== undefined) {
      if (!String(name).trim()) return res.status(400).json({ error: "name cannot be empty" });
      update.name = String(name).trim();
    }
    const before = await Zone.findById(req.params.id);
    if (!before) return res.status(404).json({ error: "Zone not found" });
    const zone = await Zone.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
    const changes = diffFields(before.toObject(), zone.toObject(), Object.keys(update));
    if (changes.length) {
      await recordAudit(req.user, "zone.update", { type: "zone", id: String(zone._id), label: zone.name }, changes);
    }
    res.json({ zone });
  } catch (err) { next(err); }
});

zonesRouter.put("/:id", async (req, res, next) => {
  try {
    const { name, type, points } = req.body;
    const zone = await Zone.findByIdAndUpdate(
      req.params.id,
      { ...(name && { name }), ...(type && { type }), ...(points && { points }) },
      { new: true, runValidators: true }
    );
    if (!zone) return res.status(404).json({ error: "Zone not found" });
    res.json({ zone });
  } catch (err) { next(err); }
});

zonesRouter.delete("/:id", async (req, res, next) => {
  try {
    const zone = await Zone.findByIdAndDelete(req.params.id);
    if (!zone) return res.status(404).json({ error: "Zone not found" });
    res.status(204).end();
  } catch (err) { next(err); }
});
