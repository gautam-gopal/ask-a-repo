import mongoose from "mongoose";
import { config } from "../config.js";

// Must match the index name you create in Atlas (see the checklist in the chat / D-024).
export const VECTOR_INDEX_NAME = "chunks_vector";

const chunkSchema = new mongoose.Schema(
  {
    repoId: { type: mongoose.Schema.Types.ObjectId, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    path: { type: String, required: true },
    startLine: { type: Number, required: true },
    endLine: { type: Number, required: true },
    text: { type: String, required: true },
    // select:false: each vector is about 9.9 KB, and only $vectorSearch needs it, so
    // normal queries and JSON responses must not load or leak it.
    embedding: {
      type: [Number],
      required: true,
      select: false,
      validate: {
        validator: (v) =>
          Array.isArray(v) && v.length === config.EMBEDDING_DIMENSIONS,
        message: "embedding length must equal EMBEDDING_DIMENSIONS",
      },
    },
    // No default: demo documents simply have no expiresAt and are never deleted by the TTL.
    expiresAt: { type: Date },
  },
  { versionKey: false },
);

chunkSchema.index({ repoId: 1 });
// expireAfterSeconds 0: MongoDB deletes each document when the clock passes its expiresAt.
chunkSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Chunk = mongoose.model("Chunk", chunkSchema);
