import express from "express";
import mongoose from "mongoose";
import { config } from "./config.js";

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
