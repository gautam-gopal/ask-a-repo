import mongoose from "mongoose";

export const REPO_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const repoSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    // Display casing (as typed, replaced by GitHub's casing when ready).
    owner: { type: String, required: true },
    name: { type: String, required: true },
    // Lowercased copies: GitHub names are case-insensitive, so these feed the unique index.
    ownerLower: { type: String, required: true },
    nameLower: { type: String, required: true },
    branch: String,
    commitSha: String,
    status: {
      type: String,
      enum: ["queued", "indexing", "ready", "failed"],
      required: true,
      default: "queued",
    },
    error: { code: String, message: String },
    fileCount: { type: Number, default: 0 },
    chunkCount: { type: Number, default: 0 },
    progress: {
      embedded: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
    },
    usage: {
      estimatedTokens: { type: Number, default: 0 },
      estimatedNeurons: { type: Number, default: 0 },
    },
    isDemo: { type: Boolean, default: false },
    expiresAt: { type: Date },
  },
  { timestamps: true, versionKey: false },
);

// Demo repos never expire (no expiresAt). Everything else expires REPO_TTL_MS after creation.
// Runs on create/save only; an update that flips isDemo must $unset expiresAt itself.
repoSchema.pre("validate", function () {
  if (this.isDemo) this.expiresAt = undefined;
  else if (!this.expiresAt) this.expiresAt = new Date(Date.now() + REPO_TTL_MS);
});

repoSchema.index({ userId: 1, ownerLower: 1, nameLower: 1 }, { unique: true });
repoSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

repoSchema.set("toJSON", {
  transform(_doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.ownerLower;
    delete ret.nameLower;
    return ret;
  },
});

export const Repo = mongoose.model("Repo", repoSchema);
