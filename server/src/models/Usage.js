import mongoose from "mongoose";

// One document per UTC day. Deleted by TTL 7 days after creation.
const usageSchema = new mongoose.Schema(
  {
    day: { type: String, required: true, unique: true }, // "2026-11-07"
    neurons: { type: Number, default: 0 },
    llmRequests: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false },
);
usageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Usage = mongoose.model("Usage", usageSchema);
