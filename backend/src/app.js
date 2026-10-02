import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./config/env.js";
import { authRouter } from "./routes/auth.js";
import { zonesRouter } from "./routes/zones.js";
import { videosRouter } from "./routes/videos.js";
import { violationsRouter } from "./routes/violations.js";
import { finesRouter } from "./routes/fines.js";
import { detectorEventsRouter } from "./routes/detectorEvents.js";
import { notFound, errorHandler } from "./middleware/errorHandler.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.use(helmet({ crossOriginResourcePolicy: false }));
  app.use(cors({ origin: env.frontendUrl }));
  app.use(morgan("dev"));
  app.use(express.json({ limit: "2mb" }));

  // Snapshots served as static files so <img src> in the dashboard just works.
  app.use("/uploads/snapshots", express.static(path.resolve(__dirname, "../uploads/snapshots")));

  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.use("/api/auth", authRouter);
  app.use("/api/zones", zonesRouter);
  app.use("/api/videos", videosRouter);
  app.use("/api/violations", violationsRouter);
  app.use("/api/fines", finesRouter);
  app.use("/api/detector/events", detectorEventsRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
