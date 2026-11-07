import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { User } from "../models/User.js";
import { validate } from "../middleware/validate.js";
import { AppError } from "../middleware/errors.js";
import {
  requireAuth,
  signToken,
  setAuthCookie,
  clearAuthCookie,
} from "../middleware/auth.js";
import { signupLimit, loginLimit } from "../middleware/rateLimit.js";
import { signupCap } from "../middleware/signupCap.js";

// Cost 10: bcryptjs is pure JS and Render free has 0.1 CPU; higher is too slow.
const BCRYPT_COST = 10;
// Compared against when the email is unknown, so unknown-email and
// wrong-password take about the same time (no timing-based enumeration).
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", BCRYPT_COST);

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));

const signupSchema = z.object({
  email,
  // bcrypt only uses the first 72 bytes, so reject longer input.
  password: z
    .string()
    .min(8, "must be at least 8 characters")
    .refine((p) => Buffer.byteLength(p) <= 72, "must be at most 72 bytes"),
});

const loginSchema = z.object({
  email,
  password: z.string().min(1, "is required").max(200),
});

export const authRouter = Router();
export const meRouter = Router();

authRouter.post(
  "/signup",
  signupLimit,
  validate(signupSchema),
  signupCap,
  async (req, res) => {
    const { email, password } = req.body;
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

    let user;
    try {
      user = await User.create({ email, passwordHash });
    } catch (err) {
      if (err?.code === 11000) {
        throw new AppError(
          409,
          "EMAIL_TAKEN",
          "An account with this email already exists",
        );
      }
      throw err;
    }

    setAuthCookie(res, signToken(user));
    res.status(201).json({ user });
  },
);

authRouter.post(
  "/login",
  loginLimit,
  validate(loginSchema),
  async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email }).select("+passwordHash");

    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) {
      throw new AppError(
        401,
        "INVALID_CREDENTIALS",
        "Invalid email or password",
      );
    }

    setAuthCookie(res, signToken(user));
    res.json({ user });
  },
);

authRouter.post("/logout", (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

meRouter.get("/", requireAuth, (req, res) => {
  res.json({ user: req.user });
});
