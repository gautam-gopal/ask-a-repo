import { randomUUID } from "node:crypto";
import { config } from "../config.js";

// Tests replace sink.write to capture lines. Nothing is printed when NODE_ENV is "test".
export const sink = {
  write: (line) => {
    if (config.NODE_ENV !== "test") console.log(line);
  },
};

// Logs ONLY: id, method, route, status, duration, userId.
export function requestLog(req, res, next) {
  const id = randomUUID();
  req.id = id;
  res.set("X-Request-Id", id);

  if (req.path === "/healthz") return next();

  const start = process.hrtime.bigint();
  let logged = false;

  const writeLog = () => {
    if (logged) return;
    logged = true;

    const rawPath = req.route
      ? `${req.baseUrl}${req.route.path}`
      : req.originalUrl.split("?")[0].slice(0, 100);

    const path = rawPath.length > 1 ? rawPath.replace(/\/+$/, "") : rawPath;

    sink.write(
      JSON.stringify({
        t: new Date().toISOString(),
        id,
        method: req.method,
        path,
        status: res.statusCode,
        ms: Number((process.hrtime.bigint() - start) / 1_000_000n),
        ...(req.user ? { userId: String(req.user._id) } : {}),
      }),
    );
  };

  // Normal completed responses.
  res.once("finish", writeLog);

  // Also log connections that close before completing.
  res.once("close", () => {
    if (!res.writableFinished) writeLog();
  });

  next();
}
