// One-off script: node src/scripts/seedAdmin.js you@college.edu "Your Name" password123
import "dotenv/config";
import { connectDB } from "../config/db.js";
import { User } from "../models/User.js";

const [email, name, password] = process.argv.slice(2);
if (!email || !name || !password) {
  console.error("Usage: node src/scripts/seedAdmin.js <email> <name> <password>");
  process.exit(1);
}

await connectDB();
if (await User.exists({ email })) {
  console.log("User already exists.");
} else {
  await User.create({ name, email, passwordHash: await User.hashPassword(password), role: "admin" });
  console.log(`Admin created: ${email}`);
}
process.exit(0);
