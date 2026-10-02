import { Router } from "express";
import jwt from "jsonwebtoken";
import { User } from "../models/User.js";
import { env } from "../config/env.js";
import { requireAuth } from "../middleware/auth.js";

export const authRouter = Router();

function issueToken(user) {
  return jwt.sign({ sub: user._id.toString(), role: user.role, name: user.name },
    env.jwtSecret, { expiresIn: env.jwtExpiresIn });
}

// First controller account is created as admin; everyone after that is "controller"
// by default, matching a small college-project deployment (no public self-serve sign-up risk).
authRouter.post("/register", async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password || password.length < 6) {
      return res.status(400).json({ error: "name, email and a password of 6+ characters are required" });
    }
    if (await User.exists({ email: email.toLowerCase() })) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }
    const role = (await User.countDocuments()) === 0 ? "admin" : "controller";
    const user = await User.create({ name, email, passwordHash: await User.hashPassword(password), role });
    res.status(201).json({ token: issueToken(user), user });
  } catch (err) { next(err); }
});

authRouter.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: (email || "").toLowerCase() });
    if (!user || !(await user.checkPassword(password || ""))) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    res.json({ token: issueToken(user), user });
  } catch (err) { next(err); }
});

authRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    res.json({ user: await User.findById(req.user.sub) });
  } catch (err) { next(err); }
});
