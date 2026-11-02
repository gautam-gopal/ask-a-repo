import { Router } from "express";
import { z } from "zod";
import { Repo } from "../models/Repo.js";
import { Chunk } from "../models/Chunk.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { AppError } from "../middleware/errors.js";
import { startIngest, IngestError } from "../services/ingest.js";
import { GithubError } from "../services/github.js";
import { retrieve } from "../services/retrieve.js";
import { EmbeddingError } from "../services/embeddings.js";

const ACTIVE = ["queued", "indexing"];
const ID_RE = /^[0-9a-f]{24}$/i;
const RETRY_AFTER_SECONDS = "60";

const createSchema = z.object({
  url: z.string().trim().min(1, "is required").max(200),
});

const INGEST_STATUS = {
  INVALID_URL: 400,
  REPO_EXISTS: 409,
  INGEST_IN_PROGRESS: 409,
  REPO_LIMIT_REACHED: 409,
  BUSY: 503,
};
const GITHUB_STATUS = {
  INVALID_URL: 400,
  REPO_NOT_FOUND: 404,
  RATE_LIMITED: 503,
  UPSTREAM_ERROR: 502,
};

const searchSchema = z.object({
  question: z.string().trim().min(1, "is required").max(500),
});

// Messages are authored here, never provider text.
function mapEmbeddingError(err, res) {
  if (!(err instanceof EmbeddingError)) return err;
  if (err.code === "QUOTA_EXHAUSTED")
    return new AppError(
      503,
      "QUOTA_EXHAUSTED",
      "The daily embedding allowance is used up. It resets at midnight UTC. Try again later.",
    );
  if (err.code === "RATE_LIMITED") {
    res.set("Retry-After", RETRY_AFTER_SECONDS);
    return new AppError(
      503,
      "EMBEDDING_RATE_LIMITED",
      "The embedding service is busy. Try again in a few minutes.",
    );
  }
  return new AppError(
    502,
    "EMBEDDING_FAILED",
    "Search failed. Try again later.",
  );
}

function hitUrl(repo, h) {
  const p = h.path.split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${repo.owner}/${repo.name}/blob/${repo.commitSha}/${p}#L${h.startLine}-L${h.endLine}`;
}

// Messages on IngestError and GithubError are authored in our own code, never provider text.
function mapError(err, res) {
  if (err instanceof IngestError && INGEST_STATUS[err.code]) {
    if (err.code === "BUSY") res.set("Retry-After", RETRY_AFTER_SECONDS);
    return new AppError(INGEST_STATUS[err.code], err.code, err.message);
  }
  if (err instanceof GithubError && GITHUB_STATUS[err.code]) {
    if (err.code === "RATE_LIMITED")
      res.set("Retry-After", RETRY_AFTER_SECONDS);
    return new AppError(GITHUB_STATUS[err.code], err.code, err.message);
  }
  return err; // unknown: the central handler logs it and sends a generic 500
}

// Explicit allowlist: userId, lowercase names, usage, isDemo and expiresAt never leave the server.
function publicRepo(r) {
  return {
    id: String(r._id),
    owner: r.owner,
    name: r.name,
    status: r.status,
    progress: {
      embedded: r.progress?.embedded ?? 0,
      total: r.progress?.total ?? 0,
    },
    error: r.error?.code
      ? { code: r.error.code, message: r.error.message }
      : null,
    fileCount: r.fileCount ?? 0,
    chunkCount: r.chunkCount ?? 0,
    branch: r.branch ?? null,
    commitSha: r.commitSha ?? null,
    createdAt: r.createdAt,
  };
}

function parseId(req) {
  if (!ID_RE.test(req.params.id))
    throw new AppError(400, "INVALID_ID", "Invalid repository id");
  return req.params.id;
}

// 404 for "not yours" and "does not exist" alike, so existence is never revealed.
async function findOwned(req) {
  const repo = await Repo.findOne({
    _id: parseId(req),
    userId: req.user._id,
  }).lean();
  if (!repo) throw new AppError(404, "REPO_NOT_FOUND", "Repository not found");
  return repo;
}

export const reposRouter = Router();
reposRouter.use(requireAuth);

reposRouter.post("/", validate(createSchema), async (req, res) => {
  let repo;
  try {
    repo = await startIngest({ userId: req.user._id, url: req.body.url });
  } catch (err) {
    throw mapError(err, res);
  }
  res.status(202).json({ repo: publicRepo(repo) });
});

reposRouter.get("/", async (req, res) => {
  const repos = await Repo.find({ userId: req.user._id })
    .sort({ createdAt: -1 })
    .lean();
  res.json({ repos: repos.map(publicRepo) });
});

reposRouter.get("/:id", async (req, res) => {
  res.json({ repo: publicRepo(await findOwned(req)) });
});

reposRouter.delete("/:id", async (req, res) => {
  const repo = await findOwned(req);
  if (ACTIVE.includes(repo.status))
    throw new AppError(
      409,
      "INGEST_IN_PROGRESS",
      "This repository is still being indexed. Wait for it to finish.",
    );
  await Repo.deleteOne({ _id: repo._id, userId: req.user._id });
  await Chunk.deleteMany({ repoId: repo._id }); // orphans (if this fails) expire via TTL
  res.json({ ok: true });
});

// Ownership and readiness are checked BEFORE any retrieval. Chunks of a deleted repo can
// linger until their TTL, so this repo-document check (not the chunk data) is what makes
// them unreachable: no repo document, no search.
reposRouter.post("/:id/search", validate(searchSchema), async (req, res) => {
  const repo = await findOwned(req);
  if (repo.status !== "ready")
    throw new AppError(
      409,
      "REPO_NOT_READY",
      "This repository is not ready yet. Wait until indexing finishes.",
    );
  let hits;
  try {
    hits = await retrieve({ repoId: repo._id, query: req.body.question });
  } catch (err) {
    throw mapEmbeddingError(err, res);
  }
  res.json({
    hits: hits.map((h) => ({
      path: h.path,
      startLine: h.startLine,
      endLine: h.endLine,
      text: h.text,
      score: h.score,
      mergedFrom: h.mergedFrom,
      url: hitUrl(repo, h),
    })),
    repo: { id: String(repo._id), commitSha: repo.commitSha },
  });
});
