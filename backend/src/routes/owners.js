import { Router } from "express";
import { Owner } from "../models/Owner.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { env } from "../config/env.js";
import { recordAudit, diffFields } from "../services/auditService.js";
import { validateOwnerInput, parsePlates } from "../services/ownerInput.js";
import { maskPhone, normalisePlate } from "../services/identity.js";

export const ownersRouter = Router();
// Owner details are personal data: admins only, for every operation.
ownersRouter.use(requireAuth, requireRole("admin"));

const cc = () => env.notifyDefaultCountryCode;
const label = (o) => `${o.name} (${(o.plates || []).join(", ")})`;
const auditView = (o) => ({ name: o.name, phone: maskPhone(o.phone), plates: o.plates, channels: o.channels });

// A plate belongs to one owner. The database's own duplicate-key error does not reliably say
// WHICH plate, so work it out from what was submitted.
async function duplicatePlate(err, res, plates = [], exceptId = null) {
  if (err?.code !== 11000) return false;
  const clash = plates.length
    ? await Owner.findOne({ plates: { $in: plates }, ...(exceptId && { _id: { $ne: exceptId } }) }).lean()
    : null;
  const plate = clash ? plates.find((p) => clash.plates.includes(p)) : plates[0];
  res.status(409).json({ error: `Plate ${plate ?? "(unknown)"} is already registered to another owner` });
  return true;
}

ownersRouter.get("/", async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.q) {
      const q = String(req.query.q).trim();
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ name: rx }, { phone: rx }, { plates: normalisePlate(q) || "__none__" }];
    }
    res.json({ owners: await Owner.find(filter).sort({ createdAt: -1 }).limit(500) });
  } catch (err) { next(err); }
});

ownersRouter.post("/", async (req, res, next) => {
  try {
    const v = validateOwnerInput(req.body, { defaultCountryCode: cc() });
    const owner = await Owner.create({
      name: v.name, phone: v.phone, plates: v.plates, channels: v.channels,
      consent: { given: true, at: new Date(), note: v.consentNote || "" },
      createdBy: req.user.sub,
    });
    await recordAudit(req.user, "owner.create", { type: "owner", id: String(owner._id), label: label(owner) },
      diffFields({}, auditView(owner), Object.keys(auditView(owner))), v.consentNote ? `Consent: ${v.consentNote}` : "");
    res.status(201).json({ owner });
  } catch (err) { if (!(await duplicatePlate(err, res, parsePlates(req.body?.plates)))) next(err); }
});

ownersRouter.put("/:id", async (req, res, next) => {
  try {
    const owner = await Owner.findById(req.params.id);
    if (!owner) return res.status(404).json({ error: "Owner not found" });
    const before = auditView(owner);
    const v = validateOwnerInput(req.body, { defaultCountryCode: cc(), partial: true });
    for (const f of ["name", "phone", "plates", "channels"]) if (v[f] !== undefined) owner[f] = v[f];
    if (v.consentNote !== undefined) owner.consent.note = v.consentNote;
    await owner.save();
    await recordAudit(req.user, "owner.update", { type: "owner", id: String(owner._id), label: label(owner) },
      diffFields(before, auditView(owner), Object.keys(before)));
    res.json({ owner });
  } catch (err) { if (!(await duplicatePlate(err, res, parsePlates(req.body?.plates), req.params.id))) next(err); }
});

// Deleting an owner removes their phone number and plates entirely (right to erasure).
ownersRouter.delete("/:id", async (req, res, next) => {
  try {
    const owner = await Owner.findByIdAndDelete(req.params.id);
    if (!owner) return res.status(404).json({ error: "Owner not found" });
    await recordAudit(req.user, "owner.delete", { type: "owner", id: String(owner._id), label: label(owner) });
    res.status(204).end();
  } catch (err) { next(err); }
});
