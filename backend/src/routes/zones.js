import { Router } from "express";
import { Zone } from "../models/Zone.js";
import { Video } from "../models/Video.js";
import { requireAuth } from "../middleware/auth.js";

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
    if (!name || !["parking", "no_parking"].includes(type) || !Array.isArray(points) || points.length < 3) {
      return res.status(400).json({ error: "name, type (parking|no_parking) and 3+ points are required" });
    }
    if (!(await Video.exists({ _id: video }))) {
      return res.status(404).json({ error: "Video not found" });
    }
    const zone = await Zone.create({ name, type, points, video, createdBy: req.user.sub });
    res.status(201).json({ zone });
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
