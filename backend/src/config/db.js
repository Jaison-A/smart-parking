import mongoose from "mongoose";
import { env } from "./env.js";

function redact(uri) {
  return uri.replace(/\/\/[^@/]+@/, "//***:***@");
}

export async function connectDB() {
  mongoose.set("strictQuery", true);
  await mongoose.connect(env.mongoUri);
  console.log(`[db] connected -> ${redact(env.mongoUri)}`);
}