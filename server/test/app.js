import express from "express";
import cookieParser from "cookie-parser";
import { authRouter, meRouter } from "../src/routes/auth.js";
import { notFound, errorHandler } from "../src/middleware/errors.js";
import { reposRouter } from "../src/routes/repos.js";

// Same wiring as index.js, minus the DB connection and static serving.
export function makeApp() {
  const app = express();
  app.use(express.json({ limit: "10kb" }));
  app.use(cookieParser());
  app.use("/api/auth", authRouter);
  app.use("/api/me", meRouter);
  app.use("/api/repos", reposRouter);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
