import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import mongoose from "mongoose";
import { config } from "./config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(here, "../../client/dist");

const DB_STATES = {
  0: "disconnected",
  1: "connected",
  2: "connecting",
  3: "disconnecting",
};

const app = express();
app.disable("x-powered-by");

app.get("/healthz", (_req, res) => {
  const db = DB_STATES[mongoose.connection.readyState] ?? "unknown";
  res
    .status(200)
    .json({ status: "ok", db, uptime: Math.round(process.uptime()) });
});

// Serve the built React app. Registered after /healthz, and future /api routes
// must be mounted above this block. Unknown /api paths fall through to a 404.
if (fs.existsSync(path.join(clientDist, "index.html"))) {
  app.use(express.static(clientDist));
  app.use((req, res, next) => {
    if (
      req.method !== "GET" ||
      req.path === "/healthz" ||
      req.path.startsWith("/api")
    ) {
      return next();
    }
    res.sendFile(path.join(clientDist, "index.html"));
  });
} else {
  console.warn("client/dist not found: run `npm run build` to serve the UI");
}

async function main() {
  try {
    await mongoose.connect(config.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
    });
  } catch (err) {
    console.error("MongoDB connection failed:", err.message);
    process.exit(1);
  }
  console.log(`MongoDB connected (db: ${mongoose.connection.name})`);

  const server = app.listen(config.PORT, () => {
    console.log(`Server listening on port ${config.PORT} (${config.NODE_ENV})`);
  });

  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down`);
    server.close(async () => {
      await mongoose.connection.close();
      process.exit(0);
    });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main();
