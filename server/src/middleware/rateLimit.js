// All rate limits live here. Stores are express-rate-limit's in-memory store: fine for ONE
// instance (Render free), but counters reset on restart and are not shared across instances
// (that would need a shared store such as Redis). See D-093.
import rateLimit from "express-rate-limit";
import { config } from "../config.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const WINDOWS = {
  signup: HOUR,
  login: 15 * MIN,
  ask: 10 * MIN,
  ingest: DAY,
  general: 15 * MIN,
};

// Mutable on purpose: defaults come from config (RL_* env vars); tests change them and call resetRateLimits().
export const limits = {
  signup: config.RL_SIGNUP_MAX,
  login: config.RL_LOGIN_MAX,
  askUser: config.RL_ASK_USER_MAX,
  askIp: config.RL_ASK_IP_MAX,
  ingestUser: config.RL_INGEST_USER_MAX,
  ingestIp: config.RL_INGEST_IP_MAX,
  general: config.RL_GENERAL_MAX,
};

const wait = (s) =>
  s < 90
    ? `${s} seconds`
    : s < 5400
      ? `${Math.ceil(s / 60)} minutes`
      : `${Math.ceil(s / 3600)} hours`;

// Only used after requireAuth, so req.user always exists.
const userKey = (req) => String(req.user._id);

function build(key, windowMs, what, extra = {}) {
  return rateLimit({
    windowMs,
    limit: limits[key],
    standardHeaders: "draft-6", // RateLimit-Limit / -Remaining / -Reset
    legacyHeaders: false,
    handler: (req, res) => {
      const reset = req.rateLimit?.resetTime;
      const secs = Math.max(
        1,
        Math.ceil((reset ? reset.getTime() - Date.now() : windowMs) / 1000),
      );
      res.set("Retry-After", String(secs));
      res.status(429).json({
        error: {
          code: "TOO_MANY_REQUESTS",
          message: `Too many ${what}. Try again in ${wait(secs)}.`,
        },
      });
    },
    ...extra,
  });
}

const buildAll = () => ({
  signup: build("signup", WINDOWS.signup, "signup attempts"),
  // skipSuccessfulRequests: only failed logins (status >= 400) count.
  login: build("login", WINDOWS.login, "failed login attempts", {
    skipSuccessfulRequests: true,
  }),
  askUser: build("askUser", WINDOWS.ask, "questions", {
    keyGenerator: userKey,
  }),
  askIp: build("askIp", WINDOWS.ask, "questions from your network"),
  ingestUser: build("ingestUser", WINDOWS.ingest, "repositories added today", {
    keyGenerator: userKey,
  }),
  ingestIp: build(
    "ingestIp",
    WINDOWS.ingest,
    "repositories added from your network",
  ),
  // Polling reads (GET /api/repos...) are skipped: the client polls every 3 s while indexing,
  // which alone would reach 300 per 15 minutes (D-092).
  general: build("general", WINDOWS.general, "requests", {
    skip: (req) => req.method === "GET" && req.path.startsWith("/repos"),
  }),
});

let built = buildAll();
const lazy = (name) => (req, res, next) => built[name](req, res, next);

export function resetRateLimits() {
  built = buildAll(); // fresh counters, current `limits` values
}

export const signupLimit = lazy("signup");
export const loginLimit = lazy("login");
export const generalLimit = lazy("general");
// One instance per limit, used on ask, ask/stream and search, so the three share one counter.
export const askLimits = [lazy("askUser"), lazy("askIp")];
export const ingestLimits = [lazy("ingestUser"), lazy("ingestIp")];
