import "dotenv/config";

function required(name, fallback) {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const env = {
  port: Number(process.env.PORT || 5000),
  mongoUri: required("MONGO_URI", "mongodb://127.0.0.1:27017/smart_parking"),
  jwtSecret: required("JWT_SECRET", "dev-secret-change-me"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  detectorApiKey: required("DETECTOR_API_KEY", "change-me-detector-key"),
  detectorUrl: process.env.DETECTOR_URL || "http://localhost:8001",
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:5173",
  fineBaseAmount: Number(process.env.FINE_BASE_AMOUNT || 500),
  finePerExtraMinute: Number(process.env.FINE_PER_EXTRA_MINUTE || 20),
};
