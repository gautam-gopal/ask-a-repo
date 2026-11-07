import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { config } from "./config.js";
import { User } from "./models/User.js";
import { Repo } from "./models/Repo.js";
import { Chunk } from "./models/Chunk.js";
import { Message } from "./models/Message.js";
import { Usage } from "./models/Usage.js";
import { recoverInterruptedIngests } from "./services/ingest.js";
import { createApp } from "./app.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = createApp({ clientDist: path.resolve(here, "../../client/dist") });

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

  await User.init(); // wait for the unique email index to exist before serving
  await Repo.init(); // unique { userId, ownerLower, nameLower } + TTL
  await Chunk.init(); // repoId + TTL
  await Message.init(); // { repoId, createdAt } + TTL
  await Usage.init(); // unique day + TTL

  try {
    await recoverInterruptedIngests(); // before listening: no request can race it
  } catch (err) {
    console.error("Ingest recovery failed:", err.message);
    process.exit(1);
  }

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
