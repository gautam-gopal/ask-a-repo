export class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function send(res, status, code, message) {
  res.status(status).json({ error: { code, message } });
}

export function notFound(_req, res) {
  send(res, 404, "NOT_FOUND", "Route not found");
}

// Express recognises an error handler by its 4 arguments; keep all 4.
export function errorHandler(err, _req, res, next) {
  if (res.headersSent) return next(err);

  if (err instanceof AppError) {
    return send(res, err.status, err.code, err.message);
  }
  if (err?.type === "entity.parse.failed") {
    return send(res, 400, "INVALID_JSON", "Request body is not valid JSON");
  }
  if (err?.type === "entity.too.large") {
    return send(res, 413, "PAYLOAD_TOO_LARGE", "Request body is too large");
  }

  // Unknown error: log server-side only, never send details to the client.
  console.error("Unhandled error:", err?.stack ?? err);
  send(res, 500, "INTERNAL", "Something went wrong");
}
