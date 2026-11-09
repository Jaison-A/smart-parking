import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { deleteTestData, testDataSummary } from "../services/testData.js";
import { recordAudit } from "../services/auditService.js";

export const testDataRouter = Router();
testDataRouter.use(requireAuth, requireRole("admin"));

// What a one-click delete would remove.
testDataRouter.get("/summary", async (_req, res, next) => {
  try { res.json({ summary: await testDataSummary() }); } catch (err) { next(err); }
});

testDataRouter.delete("/", async (req, res, next) => {
  try {
    const removed = await deleteTestData();
    await recordAudit(req.user, "test-data.delete", { type: "test-data", label: "All test records" },
      Object.entries(removed).map(([field, n]) => ({ field, from: n, to: 0 })));
    res.json({ removed });
  } catch (err) { next(err); }
});
