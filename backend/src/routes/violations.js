import { Router } from "express";
import { Violation } from "../models/Violation.js";
import { requireAuth } from "../middleware/auth.js";

export const violationsRouter = Router();
violationsRouter.use(requireAuth);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

// "Which day is this violation on?" depends on the viewer's timezone - a 1 AM IST
// violation is still "yesterday" in UTC. The client sends its IANA zone (?tz=Asia/Kolkata).
function resolveTz(req) {
  const tz = req.query.tz || "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    throw Object.assign(new Error(`Unknown timezone: ${tz}`), { status: 400 });
  }
}

function baseFilter(req) {
  const filter = {};
  if (req.query.video) filter.video = req.query.video;
  if (req.query.plate) filter.plate = new RegExp(String(req.query.plate).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  return filter;
}

const dayExpr = (tz) => ({ $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: tz } });

// Default album view: every day (newest first) with its violations in one request.
// GET /api/violations/grouped?tz=Asia/Kolkata[&month=YYYY-MM][&plate=...]
// Capped at the 1000 newest records so one request can't grow without bound.
violationsRouter.get("/grouped", async (req, res, next) => {
  try {
    const tz = resolveTz(req);
    const { month } = req.query;
    if (month && !MONTH_RE.test(month)) return res.status(400).json({ error: "month must be YYYY-MM" });

    const all = await Violation.find(baseFilter(req)).populate("fine").populate("session")
      .sort({ createdAt: -1 }).limit(1000);

    // "en-CA" formats as YYYY-MM-DD; formatting in the viewer's zone keeps days correct.
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    const days = new Map(); // Map keeps insertion order = newest day first
    for (const v of all) {
      const day = fmt.format(v.createdAt);
      if (month && !day.startsWith(`${month}-`)) continue;
      if (!days.has(day)) days.set(day, []);
      days.get(day).push(v);
    }
    res.json({
      days: [...days.entries()].map(([date, violations]) => ({ date, count: violations.length, violations })),
    });
  } catch (err) { next(err); }
});

// Album index: one row per day with a count, newest first. Optional ?month=YYYY-MM.
violationsRouter.get("/dates", async (req, res, next) => {
  try {
    const tz = resolveTz(req);
    const { month } = req.query;
    if (month && !MONTH_RE.test(month)) return res.status(400).json({ error: "month must be YYYY-MM" });

    const pipeline = [
      { $match: baseFilter(req) },
      { $addFields: { day: dayExpr(tz) } },
      ...(month ? [{ $match: { day: { $regex: `^${month}-` } } }] : []),
      { $group: { _id: "$day", count: { $sum: 1 } } },
      { $sort: { _id: -1 } },
    ];
    const rows = await Violation.aggregate(pipeline);
    res.json({ dates: rows.map((r) => ({ date: r._id, count: r.count })) });
  } catch (err) { next(err); }
});

// Everything that happened on one day: GET /api/violations/by-date/2026-10-03?tz=Asia/Kolkata
violationsRouter.get("/by-date/:date", async (req, res, next) => {
  try {
    const { date } = req.params;
    if (!DATE_RE.test(date)) return res.status(400).json({ error: "date must be YYYY-MM-DD" });
    const tz = resolveTz(req);

    const violations = await Violation.find({
      ...baseFilter(req),
      $expr: { $eq: [dayExpr(tz), date] },
    }).populate("fine").populate("session").sort({ createdAt: -1 });

    res.json({ date, count: violations.length, violations });
  } catch (err) { next(err); }
});

violationsRouter.get("/", async (req, res, next) => {
  try {
    res.json({
      violations: await Violation.find(baseFilter(req)).populate("fine").populate("session")
        .sort({ createdAt: -1 }).limit(200),
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
