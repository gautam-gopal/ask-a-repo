import { config } from "../config.js";
import { AppError } from "./errors.js";

export const DEMO_EMAIL = "demo@ask-a-repo.invalid";
export const DEMO_SESSION = "2h";
export const DEMO_SESSION_MS = 2 * 60 * 60 * 1000;
export const DEMO_MESSAGE_TTL_MS = 24 * 60 * 60 * 1000;
export const DEMO_READ_ONLY_MESSAGE =
  "The demo account is read-only. Sign up to add your own repository.";

// Mutable so tests can flip it (same pattern as capLimits).
export const demo = { enabled: config.DEMO_ENABLED };

export function requireDemoEnabled(_req, _res, next) {
  if (!demo.enabled) throw new AppError(404, "NOT_FOUND", "Route not found");
  next();
}

// Used per route AFTER requireAuth, before limiters and budgets.
export function blockDemoWrites(req, _res, next) {
  if (req.user?.isDemo)
    throw new AppError(403, "DEMO_READ_ONLY", DEMO_READ_ONLY_MESSAGE);
  next();
}

// Messages copy the repo's expiry. Demo repos have none, so their messages get 24 hours.
export function messageExpiry(repo) {
  if (repo.expiresAt) return { expiresAt: repo.expiresAt };
  if (repo.isDemo)
    return { expiresAt: new Date(Date.now() + DEMO_MESSAGE_TTL_MS) };
  return {};
}
