// Background ingest: URL -> repo (queued) -> load, chunk, embed + insert per batch -> ready | failed.
import {
  parseRepoUrl,
  loadRepo,
  GithubError,
  MAX_FILES,
  MAX_TOTAL_BYTES,
} from "./github.js";
import { chunkRepo } from "./chunker.js";
import {
  embedDocuments,
  estimateUsage,
  EmbeddingError,
  BATCH_SIZE,
} from "./embeddings.js";
import { Repo } from "../models/Repo.js";
import { Chunk } from "../models/Chunk.js";

export const MAX_REPOS_PER_USER = 3;
export const MAX_CONCURRENT_INGESTS = 2;
export const INGEST_TIMEOUT_MS = 10 * 60 * 1000;
const ACTIVE_STATUSES = ["queued", "indexing"];
const RESERVED = "reserved";
export const INTERRUPTED_MESSAGE =
  "Indexing was interrupted by a server restart. Add the repository again.";

// HTTP mapping (implemented in routes/repos.js):
//   INVALID_URL 400 | REPO_EXISTS 409 | INGEST_IN_PROGRESS 409
//   REPO_LIMIT_REACHED 409 | BUSY 503 (Retry-After)
export class IngestError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "IngestError";
    this.code = code;
  }
}

// Thrown inside runIngest when the repo document was deleted while indexing.
class RepoGoneError extends Error {}

// userKey -> repoId string (or RESERVED while startIngest is still creating the doc).
// Size is the process-wide concurrency; one entry per user is the one-active-ingest rule.
const active = new Map();
export const getActiveCount = () => active.size;

function release(repoId) {
  const id = String(repoId);
  for (const [userKey, rid] of active) if (rid === id) active.delete(userKey);
}

// ---- Safe error mapping: stored messages are fixed strings, never provider text ----
const MB = MAX_TOTAL_BYTES / (1024 * 1024);
const GITHUB_ERRORS = {
  INVALID_URL: {
    code: "INVALID_URL",
    message: "The repository URL is not valid.",
  },
  REPO_NOT_FOUND: {
    code: "REPO_NOT_FOUND",
    message:
      "Repository not found, or it is private. Only public repositories can be indexed.",
  },
  RATE_LIMITED: {
    code: "GITHUB_RATE_LIMITED",
    message: "GitHub's rate limit was reached. Try again in a while.",
  },
  TREE_TRUNCATED: {
    code: "TREE_TRUNCATED",
    message: "Repository is too large: GitHub could not list all of its files.",
  },
  REPO_TOO_LARGE: {
    code: "REPO_TOO_LARGE",
    message: `Repository is too large to index. Limits: ${MAX_FILES} files and ${MB} MB of source.`,
  },
  EMPTY_REPO: { code: "EMPTY_REPO", message: "Repository is empty." },
  NO_SUPPORTED_FILES: {
    code: "NO_SUPPORTED_FILES",
    message:
      "No supported files found. Supported types: js, jsx, ts, tsx, json, md.",
  },
  UPSTREAM_ERROR: {
    code: "GITHUB_UPSTREAM_ERROR",
    message: "GitHub did not respond properly. Try again later.",
  },
};
const EMBEDDING_ERRORS = {
  AUTH_FAILED: {
    code: "EMBEDDING_UNAVAILABLE",
    message:
      "The embedding service is not configured correctly. This is a server problem.",
  },
  RATE_LIMITED: {
    code: "EMBEDDING_RATE_LIMITED",
    message: "The embedding service is busy. Try again in a few minutes.",
  },
  QUOTA_EXHAUSTED: {
    code: "QUOTA_EXHAUSTED",
    message:
      "The daily embedding allowance is used up. It resets at midnight UTC; add the repository again after that.",
  },
  BAD_RESPONSE: {
    code: "EMBEDDING_FAILED",
    message: "The embedding service returned an unexpected response.",
  },
  DIMENSION_MISMATCH: {
    code: "EMBEDDING_FAILED",
    message: "The embedding service returned an unexpected response.",
  },
  UPSTREAM_ERROR: {
    code: "EMBEDDING_FAILED",
    message: "The embedding service failed. Try again later.",
  },
  TIMEOUT: {
    code: "EMBEDDING_TIMEOUT",
    message: "The embedding service timed out. Try again later.",
  },
};

function toSafeError(err) {
  const table =
    err instanceof GithubError
      ? GITHUB_ERRORS
      : err instanceof EmbeddingError
        ? EMBEDDING_ERRORS
        : null;
  const hit = table?.[err.code];
  if (hit) return { ...hit };
  if (
    err instanceof IngestError &&
    (err.code === "INGEST_TIMEOUT" || err.code === "NO_CONTENT")
  ) {
    return { code: err.code, message: err.message };
  }
  return {
    code: "INTERNAL",
    message: "Indexing failed because of a server error. Try again later.",
  };
}

const round1 = (n) => Math.round(n * 10) / 10;

// Update the repo; a zero match means it was deleted while indexing.
async function update(repoId, fields) {
  const res = await Repo.updateOne({ _id: repoId }, { $set: fields });
  if (!res.matchedCount) throw new RepoGoneError();
}

async function fail(repoId, err) {
  try {
    await Chunk.deleteMany({ repoId });
    if (err instanceof RepoGoneError) return;
    const safe = toSafeError(err);
    if (safe.code === "INTERNAL")
      console.error(`Ingest ${repoId} failed:`, err?.stack ?? err);
    else console.warn(`Ingest ${repoId} failed: ${safe.code}`);
    await Repo.updateOne(
      { _id: repoId },
      { $set: { status: "failed", error: safe } },
    );
  } catch (cleanupErr) {
    // Repo may stay "indexing" until the next boot recovery.
    console.error(
      `Ingest ${repoId} cleanup failed:`,
      cleanupErr?.message ?? cleanupErr,
    );
  }
}

// Never throws. Only call after startIngest has taken the slot.
export async function runIngest(repoId) {
  try {
    const repo = await Repo.findById(repoId).lean();
    if (!repo) return;

    const deadline = Date.now() + INGEST_TIMEOUT_MS;
    const checkDeadline = () => {
      if (Date.now() > deadline)
        throw new IngestError(
          "INGEST_TIMEOUT",
          `Indexing took longer than ${INGEST_TIMEOUT_MS / 60000} minutes and was stopped.`,
        );
    };

    await update(repo._id, { status: "indexing" });
    const loaded = await loadRepo(
      `https://github.com/${repo.owner}/${repo.name}`,
    );
    checkDeadline();

    const { chunks } = chunkRepo(loaded.files);
    if (chunks.length === 0)
      throw new IngestError(
        "NO_CONTENT",
        "No indexable text found in the supported files.",
      );
    await update(repo._id, {
      "progress.total": chunks.length,
      "progress.embedded": 0,
    });

    let tokens = 0;
    let neurons = 0;
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      checkDeadline();
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const texts = batch.map((c) => c.embedText);
      const vectors = await embedDocuments(texts);
      await Chunk.insertMany(
        batch.map((c, j) => ({
          repoId: repo._id,
          userId: repo.userId,
          path: c.path,
          startLine: c.startLine,
          endLine: c.endLine,
          text: c.text,
          embedding: vectors[j],
          ...(repo.expiresAt ? { expiresAt: repo.expiresAt } : {}),
        })),
        { ordered: false, throwOnValidationError: true },
      );
      const est = estimateUsage(texts);
      tokens += est.estTokens;
      neurons += est.estNeurons;
      await update(repo._id, {
        "progress.embedded": i + batch.length,
        "usage.estimatedTokens": tokens,
        "usage.estimatedNeurons": round1(neurons),
      });
    }

    const stored = await Chunk.countDocuments({ repoId: repo._id });
    if (stored !== chunks.length)
      throw new Error(`Stored ${stored} of ${chunks.length} chunks`);

    await update(repo._id, {
      status: "ready",
      owner: loaded.owner,
      name: loaded.repo,
      branch: loaded.branch,
      commitSha: loaded.sha,
      fileCount: loaded.files.length,
      chunkCount: chunks.length,
    });
  } catch (err) {
    await fail(repoId, err);
  } finally {
    release(repoId);
  }
}

export async function startIngest({ userId, url }) {
  let parsed;
  try {
    parsed = parseRepoUrl(url);
  } catch (err) {
    if (err instanceof GithubError)
      throw new IngestError("INVALID_URL", err.message);
    throw err;
  }

  // Checked and reserved synchronously (before any await) so two simultaneous
  // requests cannot both pass.
  const userKey = String(userId);
  if (active.has(userKey))
    throw new IngestError(
      "INGEST_IN_PROGRESS",
      "You already have a repository being indexed. Wait for it to finish.",
    );
  if (active.size >= MAX_CONCURRENT_INGESTS)
    throw new IngestError(
      "BUSY",
      "The server is indexing other repositories right now. Try again in a few minutes.",
    );
  active.set(userKey, RESERVED);

  let launched = false;
  try {
    const busy = await Repo.countDocuments({
      userId,
      status: { $in: ACTIVE_STATUSES },
    });
    if (busy > 0)
      throw new IngestError(
        "INGEST_IN_PROGRESS",
        "You already have a repository being indexed. Wait for it to finish.",
      );

    const ownerLower = parsed.owner.toLowerCase();
    const nameLower = parsed.repo.toLowerCase();
    const existing = await Repo.findOne({
      userId,
      ownerLower,
      nameLower,
    }).lean();
    if (existing) {
      if (existing.status !== "failed")
        throw new IngestError(
          "REPO_EXISTS",
          "This repository is already added.",
        );
      await Chunk.deleteMany({ repoId: existing._id });
      await Repo.deleteOne({ _id: existing._id });
    }

    const count = await Repo.countDocuments({ userId });
    if (count >= MAX_REPOS_PER_USER)
      throw new IngestError(
        "REPO_LIMIT_REACHED",
        `You can have at most ${MAX_REPOS_PER_USER} repositories. Delete one first.`,
      );

    let repo;
    try {
      repo = await Repo.create({
        userId,
        owner: parsed.owner,
        name: parsed.repo,
        ownerLower,
        nameLower,
        status: "queued",
      });
    } catch (err) {
      if (err?.code === 11000)
        throw new IngestError(
          "REPO_EXISTS",
          "This repository is already added.",
        );
      throw err;
    }

    active.set(userKey, String(repo._id));
    launched = true;
    void runIngest(repo._id); // not awaited; never rejects, always releases the slot
    return repo;
  } finally {
    if (!launched) active.delete(userKey);
  }
}

// Boot only, single instance: anything still queued/indexing has no worker, so it is dead.
export async function recoverInterruptedIngests() {
  const stuck = await Repo.find(
    { status: { $in: ACTIVE_STATUSES } },
    { _id: 1 },
  ).lean();
  if (stuck.length > 0) {
    const ids = stuck.map((r) => r._id);
    await Chunk.deleteMany({ repoId: { $in: ids } });
    await Repo.updateMany(
      { _id: { $in: ids } },
      {
        $set: {
          status: "failed",
          error: { code: "INTERRUPTED", message: INTERRUPTED_MESSAGE },
        },
      },
    );
  }
  console.log(`Recovered ${stuck.length} interrupted ingest(s)`);
  return stuck.length;
}
