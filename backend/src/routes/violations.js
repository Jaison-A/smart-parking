import { Router } from "express";
import { Violation } from "../models/Violation.js";
import { requireAuth } from "../middleware/auth.js";

export const violationsRouter = Router();
violationsRouter.use(requireAuth);

violationsRouter.get("/", async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.video) filter.video = req.query.video;
    if (req.query.plate) filter.plate = new RegExp(req.query.plate, "i");
    res.json({
      violations: await Violation.find(filter).populate("fine").sort({ createdAt: -1 }).limit(200),
    });
  } catch (err) { next(err); }
});

violationsRouter.post("/:id/acknowledge", async (req, res, next) => {
  try {
    const violation = await Violation.findByIdAndUpdate(
      req.params.id, { acknowledged: true }, { new: true }
    ).populate("fine");
    if (!violation) return res.status(404).json({ error: "Violation not found" });
    res.json({ violation });
  } catch (err) { next(err); }
});
