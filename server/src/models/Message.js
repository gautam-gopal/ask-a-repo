import mongoose from "mongoose";

const sourceSchema = new mongoose.Schema(
  {
    n: Number,
    path: String,
    startLine: Number,
    endLine: Number,
    url: String,
    cited: Boolean,
  },
  { _id: false },
);

const messageSchema = new mongoose.Schema(
  {
    repoId: { type: mongoose.Schema.Types.ObjectId, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    question: { type: String, required: true },
    answer: { type: String, default: null },
    notFound: { type: Boolean, required: true, default: false },
    sources: { type: [sourceSchema], default: [] },
    model: { type: String, default: null },
    usedFallback: { type: Boolean, default: false },
    // Copied from the repo; absent for demo repos so they are never deleted by the TTL.
    expiresAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

messageSchema.index({ repoId: 1, createdAt: 1 });
messageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Message = mongoose.model("Message", messageSchema);
