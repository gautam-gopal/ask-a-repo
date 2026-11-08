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
import { Message } from "../models/Message.js";
import { answerQuestion, answerQuestionStream } from "../services/answer.js";
import { LlmError } from "../services/llm.js";
import { askLimits, ingestLimits } from "../middleware/rateLimit.js";
import { askBudget, searchBudget, ingestBudget } from "../middleware/budget.js";
import { recordQueryEmbedding, recordLlm } from "../services/usage.js";
import { redact } from "../redact.js";
import { blockDemoWrites, messageExpiry } from "../middleware/demo.js";

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

const askSchema = z.object({
  question: z.string().trim().min(1, "is required").max(500),
});

const HISTORY_TURNS = 4;
const MESSAGES_LIMIT = 50;

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

// Ask pipeline errors (embedding or LLM). Messages are authored here, never provider text.
// Retry-After uses the provider's value when known, else RETRY_AFTER_SECONDS.
function mapAskError(err, res) {
  const llm = err instanceof LlmError;
  if (!llm && !(err instanceof EmbeddingError)) return err; // central handler: generic 500

  switch (err.code) {
    case "QUOTA_EXHAUSTED":
      return new AppError(
        503,
        "QUOTA_EXHAUSTED",
        "The daily embedding allowance is used up. It resets at midnight UTC. Try again later.",
      );

    case "RATE_LIMITED": {
      const secs = llm
        ? err.retryAfterSeconds
        : err.details?.retryAfterMs != null
          ? Math.ceil(err.details.retryAfterMs / 1000)
          : null;

      res.set("Retry-After", String(secs || RETRY_AFTER_SECONDS));
      return new AppError(
        503,
        llm ? "LLM_RATE_LIMITED" : "EMBEDDING_RATE_LIMITED",
        "The service is busy. Try again in a few minutes.",
      );
    }

    case "AUTH_FAILED":
      // Server misconfiguration: log the fact, never tell the client about keys.
      console.error(
        `Ask failed: ${llm ? "LLM" : "embedding"} provider rejected the server credentials`,
      );
      return new AppError(500, "INTERNAL", "Something went wrong");

    case "TIMEOUT":
      return new AppError(
        504,
        "UPSTREAM_TIMEOUT",
        "The request took too long. Try again.",
      );

    case "BAD_RESPONSE":
      if (llm && err.details?.truncated)
        return new AppError(
          502,
          "ANSWER_TOO_LONG",
          "The answer was too long to finish. Try a narrower question.",
        );

      return new AppError(
        502,
        "ANSWER_FAILED",
        "Answering failed. Try again later.",
      );

    default:
      return new AppError(
        502,
        "ANSWER_FAILED",
        "Answering failed. Try again later.",
      );
  }
}

const HEARTBEAT_MS = 15_000;

// Same mapping as mapAskError, but safe after headers are sent (no res.set) and returns a payload.
function toStreamError(err) {
  const mapped = mapAskError(err, { set() {} });

  if (mapped instanceof AppError) {
    // Fixed fields only: never err.message, details bodies or causes (could hold secrets).
    if (err instanceof LlmError || err instanceof EmbeddingError)
      console.warn(
        `Ask stream failed: ${err.name} ${err.code}${err.details?.truncated ? " (output limit)" : ""}`,
      );

    return { code: mapped.code, message: mapped.message };
  }

  console.error("Ask stream failed:", redact(mapped?.stack ?? mapped));
  return { code: "INTERNAL", message: "Something went wrong" };
}

function publicMessage(m) {
  return {
    id: String(m._id),
    question: m.question,
    answer: m.answer ?? null,
    notFound: m.notFound,
    sources: (m.sources ?? []).map((s) => ({
      n: s.n,
      path: s.path,
      startLine: s.startLine,
      endLine: s.endLine,
      url: s.url,
      cited: s.cited,
    })),
    model: m.model ?? null,
    usedFallback: m.usedFallback ?? false,
    createdAt: m.createdAt,
  };
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

// Demo visitors share one user, so their history is never read or fed to the prompt (D-103).
async function loadHistory(repo, user) {
  if (user.isDemo) return [];
  const recent = await Message.find({
    repoId: repo._id,
    userId: user._id,
    notFound: false,
  })
    .sort({ createdAt: -1, _id: -1 })
    .limit(HISTORY_TURNS)
    .lean();
  return recent
    .reverse()
    .map((m) => ({ question: m.question, answer: m.answer }));
}

export const reposRouter = Router();
reposRouter.use(requireAuth);

// Ingestion: rate limit and budget checks happen before ingestion starts.
reposRouter.post(
  "/",
  blockDemoWrites,
  ingestLimits,
  validate(createSchema),
  ingestBudget,
  async (req, res) => {
    let repo;

    try {
      repo = await startIngest({ userId: req.user._id, url: req.body.url });
    } catch (err) {
      throw mapError(err, res);
    }

    res.status(202).json({ repo: publicRepo(repo) });
  },
);

reposRouter.get("/", async (req, res) => {
  const repos = await Repo.find({ userId: req.user._id })
    .sort({ createdAt: -1 })
    .lean();

  res.json({ repos: repos.map(publicRepo) });
});

reposRouter.get("/:id", async (req, res) => {
  res.json({ repo: publicRepo(await findOwned(req)) });
});

reposRouter.delete("/:id", blockDemoWrites, async (req, res) => {
  const repo = await findOwned(req);

  if (ACTIVE.includes(repo.status))
    throw new AppError(
      409,
      "INGEST_IN_PROGRESS",
      "This repository is still being indexed. Wait for it to finish.",
    );

  await Repo.deleteOne({ _id: repo._id, userId: req.user._id });
  await Chunk.deleteMany({ repoId: repo._id }); // orphans (if this fails) expire via TTL
  await Message.deleteMany({ repoId: repo._id }); // same: orphans expire via TTL

  res.json({ ok: true });
});

// Ownership and readiness are checked BEFORE any retrieval. Chunks of a deleted repo can
// linger until their TTL, so this repo-document check (not the chunk data) is what makes
// them unreachable: no repo document, no search.
reposRouter.post(
  "/:id/search",
  askLimits,
  validate(searchSchema),
  searchBudget,
  async (req, res) => {
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
      await recordQueryEmbedding(req.body.question);
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
  },
);

reposRouter.post(
  "/:id/ask",
  askLimits,
  validate(askSchema),
  askBudget,
  async (req, res) => {
    const repo = await findOwned(req);

    if (repo.status !== "ready")
      throw new AppError(
        409,
        "REPO_NOT_READY",
        "This repository is not ready yet. Wait until indexing finishes.",
      );

    const { question } = req.body;

    let result;

    try {
      const history = await loadHistory(repo, req.user);

      const hits = await retrieve({ repoId: repo._id, query: question });
      await recordQueryEmbedding(question);

      result = await answerQuestion({ question, hits, history });

      if (!result.notFound) await recordLlm(result.usedFallback ? 2 : 1);
    } catch (err) {
      throw mapAskError(err, res); // nothing is saved when the pipeline fails
    }

    const sources = result.notFound
      ? []
      : result.sources.map((s) => ({
          n: s.n,
          path: s.path,
          startLine: s.startLine,
          endLine: s.endLine,
          url: hitUrl(repo, s),
          cited: s.cited,
        }));

    const model = result.model ?? null;
    const usedFallback = result.usedFallback ?? false;

    const saved = await Message.create({
      repoId: repo._id,
      userId: req.user._id,
      question,
      answer: result.answer,
      notFound: result.notFound,
      sources,
      model,
      usedFallback,
      ...messageExpiry(repo),
    });

    res.json({
      id: String(saved._id),
      answer: result.answer,
      notFound: result.notFound,
      sources,
      model,
      usedFallback,
      repo: { id: String(repo._id), commitSha: repo.commitSha },
    });
  },
);

reposRouter.get("/:id/messages", async (req, res) => {
  const repo = await findOwned(req);
  if (req.user.isDemo) return res.json({ messages: [] });

  const recent = await Message.find({
    repoId: repo._id,
    userId: req.user._id,
  })
    .sort({ createdAt: -1, _id: -1 })
    .limit(MESSAGES_LIMIT)
    .lean();

  res.json({ messages: recent.reverse().map(publicMessage) });
});

// SSE ask. Everything that can fail before the stream (validation, ownership, readiness,
// history, retrieval) is a normal JSON error. After flushHeaders only SSE events are written.
// No compression middleware exists in app.js; if one is added it must skip this route.
reposRouter.post(
  "/:id/ask/stream",
  askLimits,
  validate(askSchema),
  askBudget,
  async (req, res) => {
    const repo = await findOwned(req);

    if (repo.status !== "ready")
      throw new AppError(
        409,
        "REPO_NOT_READY",
        "This repository is not ready yet. Wait until indexing finishes.",
      );

    const { question } = req.body;

    // res "close" (not req): req "close" fires when the request body is read, not on disconnect.
    const ac = new AbortController();

    res.on("close", () => {
      if (!res.writableFinished) ac.abort();
    });

    let hits;
    let history;

    try {
      history = await loadHistory(repo, req.user);

      hits = await retrieve({ repoId: repo._id, query: question });
      await recordQueryEmbedding(question);
    } catch (err) {
      throw mapAskError(err, res);
    }

    if (ac.signal.aborted) return;

    res.status(200).set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    res.flushHeaders();

    const alive = () => !res.writableEnded && !res.destroyed;

    const send = (event, data) => {
      if (alive())
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const heartbeat = setInterval(() => {
      if (alive()) res.write(": keep-alive\n\n");
    }, HEARTBEAT_MS);

    try {
      const result = await answerQuestionStream({
        question,
        hits,
        history,
        signal: ac.signal,
        onSources: (used) =>
          send("sources", {
            sources: used.map((s) => ({
              n: s.n,
              path: s.path,
              startLine: s.startLine,
              endLine: s.endLine,
              url: hitUrl(repo, s),
              cited: false,
            })),
          }),
        onToken: (t) => {
          if (!ac.signal.aborted) send("token", { t });
        },
      });

      if (!result.notFound) await recordLlm(result.usedFallback ? 2 : 1); // spent even if the client left

      if (ac.signal.aborted) return; // client left: save nothing

      const sources = result.notFound
        ? []
        : result.sources.map((s) => ({
            n: s.n,
            path: s.path,
            startLine: s.startLine,
            endLine: s.endLine,
            url: hitUrl(repo, s),
            cited: s.cited,
          }));

      const model = result.model ?? null;
      const usedFallback = result.usedFallback ?? false;

      const saved = await Message.create({
        repoId: repo._id,
        userId: req.user._id,
        question,
        answer: result.answer,
        notFound: result.notFound,
        sources,
        model,
        usedFallback,
        ...messageExpiry(repo),
      });

      send("done", {
        id: String(saved._id),
        answer: result.answer,
        notFound: result.notFound,
        sources,
        model,
        usedFallback,
        usage: result.usage ?? null,
      });
    } catch (err) {
      if (!ac.signal.aborted) {
        send("error", toStreamError(err));
      }
    } finally {
      clearInterval(heartbeat);
      if (!res.writableEnded) res.end();
    }
  },
);
