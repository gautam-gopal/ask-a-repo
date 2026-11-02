import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";

vi.mock("../src/models/Repo.js", async () => ({
  Repo: (await import("./fakeIngestModels.js")).fakeRepo,
}));
vi.mock("../src/models/Chunk.js", async () => ({
  Chunk: (await import("./fakeIngestModels.js")).fakeChunk,
}));
vi.mock("../src/services/retrieve.js", () => ({ retrieve: vi.fn() }));

import { retrieve } from "../src/services/retrieve.js";
import { EmbeddingError } from "../src/services/embeddings.js";
import { fakeRepo, resetIngestModels } from "./fakeIngestModels.js";
import { makeApp } from "./app.js";

const app = makeApp();
const U1 = "0".repeat(23) + "1";
const SHA = "a".repeat(40);
const MISSING = "f".repeat(24);

let a1;
let a2;
async function agentFor(email) {
  const a = request.agent(app);
  await a
    .post("/api/auth/signup")
    .send({ email, password: "correct-horse-1" })
    .expect(201);
  return a;
}
const seed = (over = {}) =>
  fakeRepo.create({
    userId: U1,
    owner: "octo",
    name: "hello",
    ownerLower: "octo",
    nameLower: "hello",
    status: "ready",
    commitSha: SHA,
    ...over,
  });
const search = (agent, id, body = { question: "where is auth" }) =>
  agent.post(`/api/repos/${id}/search`).send(body);

beforeEach(async () => {
  resetIngestModels();
  retrieve.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  a1 = await agentFor("one@example.com");
  a2 = await agentFor("two@example.com");
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/repos/:id/search", () => {
  it("requires auth", async () => {
    const res = await request(app)
      .post(`/api/repos/${MISSING}/search`)
      .send({ question: "x" });
    expect(res.status).toBe(401);
    expect(retrieve).not.toHaveBeenCalled();
  });

  it.each([
    [{}],
    [{ question: 5 }],
    [{ question: "   " }],
    [{ question: "x".repeat(501) }],
  ])("400 VALIDATION_ERROR for %j", async (body) => {
    const r = await seed();
    const res = await search(a1, r._id, body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("another user's repo is 404, identical to a missing one, and retrieve never runs", async () => {
    const r = await seed();
    const theirs = await search(a2, r._id);
    const missing = await search(a2, MISSING);
    expect(theirs.status).toBe(404);
    expect(theirs.body).toEqual(missing.body);
    expect(retrieve).not.toHaveBeenCalled();
  });

  it.each(["queued", "indexing", "failed"])(
    "%s repo is 409 REPO_NOT_READY",
    async (status) => {
      const r = await seed({ status });
      const res = await search(a1, r._id);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("REPO_NOT_READY");
      expect(retrieve).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["QUOTA_EXHAUSTED", 503, "QUOTA_EXHAUSTED"],
    ["RATE_LIMITED", 503, "EMBEDDING_RATE_LIMITED"],
    ["AUTH_FAILED", 502, "EMBEDDING_FAILED"],
    ["TIMEOUT", 502, "EMBEDDING_FAILED"],
    ["UPSTREAM_ERROR", 502, "EMBEDDING_FAILED"],
  ])("maps EmbeddingError %s to %i", async (code, status, stored) => {
    const r = await seed();
    retrieve.mockRejectedValue(
      new EmbeddingError(code, "LEAK test-cf-token-not-real"),
    );
    const res = await search(a1, r._id);
    expect(res.status).toBe(status);
    expect(res.body.error.code).toBe(stored);
    expect(JSON.stringify(res.body)).not.toContain("LEAK");
  });

  it("returns allowlisted hits with SHA-pinned URLs and no internal fields", async () => {
    const r = await seed();
    retrieve.mockResolvedValue([
      {
        path: "src/a b.js",
        startLine: 10,
        endLine: 20,
        text: "code",
        score: 0.83,
        mergedFrom: 2,
        embedding: [0.1],
        _id: "x",
        userId: U1,
      },
    ]);
    const res = await search(a1, r._id, { question: "  where is auth  " });
    expect(res.status).toBe(200);
    expect(retrieve).toHaveBeenCalledWith({
      repoId: r._id,
      query: "where is auth",
    });
    expect(res.body.repo).toEqual({ id: String(r._id), commitSha: SHA });
    expect(res.body.hits).toEqual([
      {
        path: "src/a b.js",
        startLine: 10,
        endLine: 20,
        text: "code",
        score: 0.83,
        mergedFrom: 2,
        url: `https://github.com/octo/hello/blob/${SHA}/src/a%20b.js#L10-L20`,
      },
    ]);
    const dump = JSON.stringify(res.body);
    for (const f of ["embedding", "_id", "userId"])
      expect(dump).not.toContain(f);
  });
});
