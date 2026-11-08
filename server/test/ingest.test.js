import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../src/models/Repo.js", async () => ({
  Repo: (await import("./fakeIngestModels.js")).fakeRepo,
}));
vi.mock("../src/models/Chunk.js", async () => ({
  Chunk: (await import("./fakeIngestModels.js")).fakeChunk,
}));
vi.mock("../src/services/github.js", async (importOriginal) => ({
  ...(await importOriginal()),
  loadRepo: vi.fn(),
}));
vi.mock("../src/services/embeddings.js", async (importOriginal) => ({
  ...(await importOriginal()),
  embedDocuments: vi.fn(),
}));

import { loadRepo, GithubError } from "../src/services/github.js";
import {
  embedDocuments,
  estimateUsage,
  EmbeddingError,
} from "../src/services/embeddings.js";
import {
  startIngest,
  recoverInterruptedIngests,
  getActiveCount,
  IngestError,
  MAX_REPOS_PER_USER,
  INTERRUPTED_MESSAGE,
} from "../src/services/ingest.js";
import {
  fakeRepo,
  repos,
  chunks,
  resetIngestModels,
} from "./fakeIngestModels.js";
import { config } from "../src/config.js";

const U1 = "1".repeat(24);
const U2 = "2".repeat(24);
const U3 = "3".repeat(24);
const URL1 = "https://github.com/octo/hello";
const URL2 = "https://github.com/octo/other";

const files = (n) =>
  Array.from({ length: n }, (_, i) => ({
    path: `f${i}.js`,
    text: "const a = 1;",
  }));
const loaded = (n) => ({
  owner: "Octo",
  repo: "Hello",
  branch: "main",
  sha: "a".repeat(40),
  files: files(n),
  skipped: {},
});
const okEmbed = async (texts) => texts.map(() => [0.1]);
const idle = () => vi.waitFor(() => expect(getActiveCount()).toBe(0));
const gate = () => {
  let open;
  const p = new Promise((r) => (open = r));
  return { p, open };
};
async function codeOf(promise) {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(IngestError);
    return err.code;
  }
  throw new Error("expected the promise to reject");
}
const seedRepo = (over = {}) =>
  fakeRepo.create({
    userId: U1,
    owner: "octo",
    name: "hello",
    ownerLower: "octo",
    nameLower: "hello",
    status: "ready",
    ...over,
  });

beforeEach(() => {
  resetIngestModels();
  loadRepo.mockReset();
  embedDocuments.mockReset();
  loadRepo.mockResolvedValue(loaded(3));
  embedDocuments.mockImplementation(okEmbed);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("happy path", () => {
  it("queued -> indexing -> ready, batches of 32, progress after each batch", async () => {
    loadRepo.mockResolvedValue(loaded(70));
    const spy = vi.spyOn(fakeRepo, "updateOne");
    const repo = await startIngest({ userId: U1, url: URL1 });
    expect(repo.status).toBe("queued"); // returned before the work finishes
    await idle();

    const sets = spy.mock.calls.map((c) => c[1].$set);
    expect(sets.map((s) => s.status).filter(Boolean)).toEqual([
      "indexing",
      "ready",
    ]);
    expect(
      sets.map((s) => s["progress.embedded"]).filter((v) => v !== undefined),
    ).toEqual([0, 32, 64, 70]);
    expect(embedDocuments.mock.calls.map((c) => c[0].length)).toEqual([
      32, 32, 6,
    ]);

    const stored = repos[0];
    expect(stored).toMatchObject({
      status: "ready",
      chunkCount: 70,
      fileCount: 70,
      branch: "main",
      commitSha: "a".repeat(40),
      owner: "Octo",
      name: "Hello",
      progress: { embedded: 70, total: 70 },
    });
    expect(stored.usage.estimatedTokens).toBeGreaterThan(0);
    expect(chunks).toHaveLength(70);
    expect(
      chunks.every(
        (c) =>
          c.repoId === stored._id &&
          c.userId === U1 &&
          c.expiresAt.getTime() === stored.expiresAt.getTime(),
      ),
    ).toBe(true);
  });

  it("estimateUsage is chars/4 per text", () => {
    expect(estimateUsage(["abcd", "abcde"]).estTokens).toBe(3);
  });

  it("passes INDEX_EXCLUDE_TESTS to loadRepo", async () => {
    await startIngest({ userId: U1, url: URL1 });
    await idle();
    expect(loadRepo).toHaveBeenCalledWith(expect.any(String), {
      excludeTests: config.INDEX_EXCLUDE_TESTS,
    });
  });
});

describe("failure handling", () => {
  it("failure mid-embedding deletes partial chunks and marks failed", async () => {
    loadRepo.mockResolvedValue(loaded(70));
    embedDocuments
      .mockImplementationOnce(okEmbed)
      .mockRejectedValueOnce(
        new EmbeddingError("QUOTA_EXHAUSTED", "raw test-cf-token-not-real"),
      );
    await startIngest({ userId: U1, url: URL1 });
    await idle();
    expect(chunks).toHaveLength(0);
    expect(repos[0].status).toBe("failed");
    expect(repos[0].error.code).toBe("QUOTA_EXHAUSTED");
    expect(repos[0].error.message).toMatch(/midnight UTC/);
    expect(JSON.stringify(repos[0].error)).not.toContain("test-cf-token");
  });

  it.each([
    ["INVALID_URL", "INVALID_URL"],
    ["REPO_NOT_FOUND", "REPO_NOT_FOUND"],
    ["RATE_LIMITED", "GITHUB_RATE_LIMITED"],
    ["TREE_TRUNCATED", "TREE_TRUNCATED"],
    ["REPO_TOO_LARGE", "REPO_TOO_LARGE"],
    ["EMPTY_REPO", "EMPTY_REPO"],
    ["NO_SUPPORTED_FILES", "NO_SUPPORTED_FILES"],
    ["UPSTREAM_ERROR", "GITHUB_UPSTREAM_ERROR"],
  ])("maps GithubError %s to %s", async (code, stored) => {
    loadRepo.mockRejectedValue(new GithubError(code, "LEAK raw text"));
    await startIngest({ userId: U1, url: URL1 });
    await idle();
    expect(repos[0].status).toBe("failed");
    expect(repos[0].error.code).toBe(stored);
    expect(repos[0].error.message).not.toContain("LEAK");
  });

  it.each([
    ["AUTH_FAILED", "EMBEDDING_UNAVAILABLE"],
    ["RATE_LIMITED", "EMBEDDING_RATE_LIMITED"],
    ["QUOTA_EXHAUSTED", "QUOTA_EXHAUSTED"],
    ["BAD_RESPONSE", "EMBEDDING_FAILED"],
    ["DIMENSION_MISMATCH", "EMBEDDING_FAILED"],
    ["UPSTREAM_ERROR", "EMBEDDING_FAILED"],
    ["TIMEOUT", "EMBEDDING_TIMEOUT"],
  ])("maps EmbeddingError %s to %s", async (code, stored) => {
    embedDocuments.mockRejectedValue(new EmbeddingError(code, "LEAK raw text"));
    await startIngest({ userId: U1, url: URL1 });
    await idle();
    expect(repos[0].error.code).toBe(stored);
    expect(repos[0].error.message).not.toContain("LEAK");
    expect(chunks).toHaveLength(0);
  });

  it("unknown errors become a generic INTERNAL message with no secrets", async () => {
    loadRepo.mockRejectedValue(
      new Error("x mongodb+srv://u:pw@h test-github-token-not-real"),
    );
    await startIngest({ userId: U1, url: URL1 });
    await idle();
    expect(repos[0].error.code).toBe("INTERNAL");
    const dump = JSON.stringify(repos[0].error);
    expect(dump).not.toContain("mongodb");
    expect(dump).not.toContain("test-github-token");
  });

  it("releases the slot after a failure, and a failed repo can be retried", async () => {
    loadRepo.mockRejectedValueOnce(new GithubError("UPSTREAM_ERROR", "x"));
    await startIngest({ userId: U1, url: URL1 });
    await idle();
    expect(repos[0].status).toBe("failed");
    const failedId = repos[0]._id;

    await startIngest({ userId: U1, url: URL1 }); // loadRepo now resolves
    await idle();
    expect(repos).toHaveLength(1);
    expect(repos[0]._id).not.toBe(failedId);
    expect(repos[0].status).toBe("ready");
  });

  it("stops and removes chunks if the repo is deleted mid-ingest", async () => {
    loadRepo.mockImplementation(async () => {
      await fakeRepo.deleteOne({ _id: repos[0]._id });
      return loaded(3);
    });
    await startIngest({ userId: U1, url: URL1 });
    await idle();
    expect(repos).toHaveLength(0);
    expect(chunks).toHaveLength(0);
    expect(embedDocuments).not.toHaveBeenCalled();
  });
});

describe("limits", () => {
  it("rejects an invalid URL without creating anything", async () => {
    expect(
      await codeOf(startIngest({ userId: U1, url: "http://evil.com/o/r" })),
    ).toBe("INVALID_URL");
    expect(repos).toHaveLength(0);
    expect(getActiveCount()).toBe(0);
  });

  it("REPO_LIMIT_REACHED at MAX_REPOS_PER_USER", async () => {
    for (let i = 0; i < MAX_REPOS_PER_USER; i++)
      await seedRepo({ name: `r${i}`, nameLower: `r${i}` });
    expect(await codeOf(startIngest({ userId: U1, url: URL1 }))).toBe(
      "REPO_LIMIT_REACHED",
    );
    expect(repos).toHaveLength(MAX_REPOS_PER_USER);
    expect(loadRepo).not.toHaveBeenCalled();
    expect(getActiveCount()).toBe(0);
  });

  it("one active ingest per user", async () => {
    const g = gate();
    loadRepo.mockImplementation(() => g.p.then(() => loaded(3)));
    await startIngest({ userId: U1, url: URL1 });
    expect(await codeOf(startIngest({ userId: U1, url: URL2 }))).toBe(
      "INGEST_IN_PROGRESS",
    );
    expect(repos).toHaveLength(1);
    g.open();
    await idle();
    expect(repos[0].status).toBe("ready");
  });

  it("BUSY when MAX_CONCURRENT_INGESTS is reached, and nothing is created", async () => {
    const g = gate();
    loadRepo.mockImplementation(() => g.p.then(() => loaded(3)));
    await startIngest({ userId: U1, url: URL1 });
    await startIngest({ userId: U2, url: URL1 });
    expect(await codeOf(startIngest({ userId: U3, url: URL1 }))).toBe("BUSY");
    expect(repos).toHaveLength(2);
    g.open();
    await idle();
  });

  it("REPO_EXISTS for an existing non-failed repo, any URL casing", async () => {
    await seedRepo({ status: "ready" });
    expect(
      await codeOf(
        startIngest({ userId: U1, url: "https://github.com/Octo/Hello" }),
      ),
    ).toBe("REPO_EXISTS");
    expect(getActiveCount()).toBe(0);
  });

  it("replaces a failed repo and deletes its old chunks", async () => {
    const old = await seedRepo({ status: "failed" });
    chunks.push({ _id: "c1", repoId: old._id, path: "x.js" });
    const fresh = await startIngest({ userId: U1, url: URL1 });
    await idle();
    expect(fresh._id).not.toBe(old._id);
    expect(repos).toHaveLength(1);
    expect(chunks.some((c) => c.repoId === old._id)).toBe(false);
    expect(repos[0].status).toBe("ready");
  });
});

describe("recoverInterruptedIngests", () => {
  it("marks queued and indexing repos failed, deletes their chunks, leaves others", async () => {
    const q = await seedRepo({ name: "q", nameLower: "q", status: "queued" });
    const i = await seedRepo({ name: "i", nameLower: "i", status: "indexing" });
    const r = await seedRepo({ name: "r", nameLower: "r", status: "ready" });
    for (const repo of [q, i, r])
      chunks.push({ _id: `c-${repo._id}`, repoId: repo._id });

    expect(await recoverInterruptedIngests()).toBe(2);
    const by = (id) => repos.find((x) => x._id === id);
    for (const repo of [q, i]) {
      expect(by(repo._id).status).toBe("failed");
      expect(by(repo._id).error).toEqual({
        code: "INTERRUPTED",
        message: INTERRUPTED_MESSAGE,
      });
    }
    expect(by(r._id).status).toBe("ready");
    expect(chunks.map((c) => c.repoId)).toEqual([r._id]);
  });

  it("does nothing when nothing is stuck", async () => {
    expect(await recoverInterruptedIngests()).toBe(0);
  });
});

describe("demo repos", () => {
  it("isDemo skips the per-user cap, and the repo and chunks have no expiry", async () => {
    for (let i = 0; i < MAX_REPOS_PER_USER; i++)
      await seedRepo({ name: `r${i}`, nameLower: `r${i}` });
    expect(await codeOf(startIngest({ userId: U1, url: URL1 }))).toBe(
      "REPO_LIMIT_REACHED",
    );
    const repo = await startIngest({ userId: U1, url: URL1, isDemo: true });
    await idle();
    const stored = repos.find((r) => r._id === repo._id);
    expect(stored).toMatchObject({ isDemo: true, status: "ready" });
    expect(stored.expiresAt).toBeUndefined();
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => c.expiresAt === undefined)).toBe(true);
  });
});
