import { AppError } from "./errors.js";

// Validates req.body against a zod schema and replaces it with the parsed
// (trimmed, lowercased, unknown-keys-stripped) result.
export function validate(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const message = result.error.issues
        .map((i) =>
          i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message,
        )
        .join("; ");
      return next(new AppError(400, "VALIDATION_ERROR", message));
    }
    req.body = result.data;
    next();
  };
}
