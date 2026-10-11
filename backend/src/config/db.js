import mongoose from "mongoose";
import { env } from "./env.js";

// Never log a connection string verbatim - it carries the username and password
// right in the URL (mongodb+srv://user:password@...). Mask the credentials,
// keep the host/db name since that's genuinely useful for confirming you
// connected to the right place.
function redact(uri) {
  return uri.replace(/\/\/[^@/]+@/, "//***:***@");
}

export async function connectDB() {
  mongoose.set("strictQuery", true);
  await mongoose.connect(env.mongoUri);
  console.log(`[db] connected -> ${redact(env.mongoUri)}`);
}
