import fs from "node:fs";
import path from "node:path";
import express from "express";
import helmet from "helmet";
import mongoose from "mongoose";
import cookieParser from "cookie-parser";
import { config } from "./config.js";
import { authRouter, meRouter } from "./routes/auth.js";
import { reposRouter } from "./routes/repos.js";
import { notFound, errorHandler } from "./middleware/errors.js";
import { requestLog } from "./middleware/requestLog.js";
import { generalLimit } from "./middleware/rateLimit.js";

const DB_STATES = {
  0: "disconnected",
  1: "connected",
  2: "connecting",
  3: "disconnecting",
};

export function createApp({ clientDist } = {}) {
  const app = express();
  // Render puts N proxies in front of us. Without this, req.ip is the proxy's address, so every
  // user shares one rate-limit bucket. With N hops trusted, Express takes the client IP from
  // X-Forwarded-For counting N entries from the right, so a spoofed left-hand value is ignored (D-091).
  app.set("trust proxy", config.TRUST_PROXY);
  app.disable("x-powered-by");
  app.use(requestLog);
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          // Vite's build is external module scripts and an external stylesheet; React sets
          // style via the DOM (not inline attributes), so no 'unsafe-inline' is needed (D-096).
          "script-src": ["'self'"],
          "style-src": ["'self'"],
          "img-src": ["'self'", "data:"],
          "font-src": ["'self'"],
          "connect-src": ["'self'"], // fetch and the SSE stream are same-origin
          "frame-ancestors": ["'none'"],
          // Would make http://localhost subresources fail in dev.
          "upgrade-insecure-requests":
            config.NODE_ENV === "production" ? [] : null,
        },
      },
    }),
  );

  app.get("/healthz", (_req, res) => {
    const db = DB_STATES[mongoose.connection.readyState] ?? "unknown";
    res
      .status(200)
      .json({ status: "ok", db, uptime: Math.round(process.uptime()) });
  });

  app.use("/api", generalLimit); // before body parsing: floods are rejected cheaply
  app.use(express.json({ limit: "16kb" }));
  app.use(cookieParser());

  app.use("/api/auth", authRouter);
  app.use("/api/me", meRouter);
  app.use("/api/repos", reposRouter); // must stay above the static / SPA block

  if (clientDist && fs.existsSync(path.join(clientDist, "index.html"))) {
    app.use(express.static(clientDist));
    app.use((req, res, next) => {
      if (
        req.method !== "GET" ||
        req.path === "/healthz" ||
        req.path.startsWith("/api")
      )
        return next();
      res.sendFile(path.join(clientDist, "index.html"));
    });
  } else if (clientDist) {
    console.warn("client/dist not found: run `npm run build` to serve the UI");
  }

  app.use(notFound); // JSON 404, including unknown /api routes
  app.use(errorHandler);
  return app;
}
