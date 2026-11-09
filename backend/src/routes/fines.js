import { Router } from "express";
import { Fine } from "../models/Fine.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { recordAudit } from "../services/auditService.js";

const fineLabel = (f) => `${f.plate || "plate not read"} - Rs ${f.amount}`;

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
    const before = await Fine.findById(req.params.id);
    if (!before) return res.status(404).json({ error: "Fine not found" });
    const fine = await Fine.findByIdAndUpdate(req.params.id, { status: "paid" }, { new: true });
    await recordAudit(req.user, "fine.paid", { type: "fine", id: String(fine._id), label: fineLabel(fine) },
      [{ field: "status", from: before.status, to: "paid" }]);
    res.json({ fine });
  } catch (err) { next(err); }
});

// Cancelling an auto-issued fine (e.g. a misread plate) is restricted to admins,
// so a false positive can be corrected without letting anyone waive fines silently.
finesRouter.post("/:id/cancel", requireRole("admin"), async (req, res, next) => {
  try {
    const before = await Fine.findById(req.params.id);
    if (!before) return res.status(404).json({ error: "Fine not found" });
    const fine = await Fine.findByIdAndUpdate(
      req.params.id,
      { status: "cancelled", cancelledBy: req.user.sub, cancelReason: req.body?.reason || "" },
      { new: true }
    );
    await recordAudit(req.user, "fine.cancelled", { type: "fine", id: String(fine._id), label: fineLabel(fine) },
      [{ field: "status", from: before.status, to: "cancelled" }], req.body?.reason || "");
    res.json({ fine });
  } catch (err) { next(err); }
});
