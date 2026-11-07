import { User } from "../models/User.js";
import { AppError } from "./errors.js";
import { config } from "../config.js";

export const capLimits = { maxUsers: config.MAX_USERS }; // mutable for tests

// estimatedDocumentCount reads collection metadata (cheap). Two simultaneous signups can
// both pass at cap-1 and overshoot by a user or two; acceptable for a cap that only protects storage.
export async function signupCap(_req, _res, next) {
  if ((await User.estimatedDocumentCount()) >= capLimits.maxUsers)
    throw new AppError(
      503,
      "SIGNUPS_CLOSED",
      "Signups are closed right now because the demo is full.",
    );
  next();
}
