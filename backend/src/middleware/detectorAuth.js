import { env } from "../config/env.js";

// The Python detection service authenticates with a shared key, not a user JWT.
export function requireDetectorKey(req, res, next) {
  if (req.headers["x-detector-key"] !== env.detectorApiKey) {
    return res.status(401).json({ error: "Invalid detector key" });
  }
  next();
}
