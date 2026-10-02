import { Router } from "express";
import { Fine } from "../models/Fine.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const finesRouter = Router();
finesRouter.use(requireAuth);

finesRouter.get("/", async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.plate) filter.plate = new RegExp(req.query.plate, "i");
    res.json({
      fines: await Fine.find(filter).populate({ path: "violation", populate: "session" })
        .sort({ createdAt: -1 }).limit(200),
    });
  } catch (err) { next(err); }
});

finesRouter.post("/:id/pay", async (req, res, next) => {
  try {
    const fine = await Fine.findByIdAndUpdate(req.params.id, { status: "paid" }, { new: true });
    if (!fine) return res.status(404).json({ error: "Fine not found" });
    res.json({ fine });
  } catch (err) { next(err); }
});

// Cancelling an auto-issued fine (e.g. a misread plate) is restricted to admins,
// so a false positive can be corrected without letting anyone waive fines silently.
finesRouter.post("/:id/cancel", requireRole("admin"), async (req, res, next) => {
  try {
    const fine = await Fine.findByIdAndUpdate(
      req.params.id,
      { status: "cancelled", cancelledBy: req.user.sub, cancelReason: req.body?.reason || "" },
      { new: true }
    );
    if (!fine) return res.status(404).json({ error: "Fine not found" });
    res.json({ fine });
  } catch (err) { next(err); }
});
