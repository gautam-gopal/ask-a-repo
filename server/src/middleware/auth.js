import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { User } from "../models/User.js";
import { AppError } from "./errors.js";

const COOKIE_NAME = "token";
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Shared by set and clear: the browser only deletes a cookie whose
// attributes match the one it stored.
const baseCookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: config.NODE_ENV === "production",
  path: "/",
};

export function signToken(user, expiresIn = "7d") {
  return jwt.sign({}, config.JWT_SECRET, {
    algorithm: "HS256",
    subject: String(user._id),
    expiresIn,
  });
}

export function setAuthCookie(res, token, maxAgeMs = SEVEN_DAYS_MS) {
  res.cookie(COOKIE_NAME, token, {
    ...baseCookieOptions,
    maxAge: maxAgeMs,
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, baseCookieOptions);
}

export async function requireAuth(req, _res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) throw new AppError(401, "UNAUTHENTICATED", "Not signed in");

  let payload;
  try {
    payload = jwt.verify(token, config.JWT_SECRET, { algorithms: ["HS256"] });
  } catch {
    throw new AppError(401, "UNAUTHENTICATED", "Invalid or expired session");
  }

  const user = await User.findById(payload.sub);
  if (!user)
    throw new AppError(401, "UNAUTHENTICATED", "Invalid or expired session");

  req.user = user;
  next();
}
