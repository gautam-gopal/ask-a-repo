import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";

vi.mock("../src/models/Repo.js", async () => ({
  Repo: (await import("./fakeIngestModels.js")).fakeRepo,
}));
vi.mock("../src/models/Chunk.js", async () => ({
  Chunk: (await import("./fakeIngestModels.js")).fakeChunk,
}));
vi.mock("../src/services/ingest.js", async (importOriginal) => ({
  ...(await importOriginal()),
  startIngest: vi.fn(),
}));

import { startIngest, IngestError } from "../src/services/ingest.js";
import { GithubError } from "../src/services/github.js";
import {
  fakeRepo,
  repos,
  chunks,
  resetIngestModels,
} from "./fakeIngestModels.js";
import { makeApp } from "./app.js";

const app = makeApp();
const U1 = "0".repeat(23) + "1"; // fake User ids are issued in signup order
const U2 = "0".repeat(23) + "2";
const URL1 = "https://github.com/octo/hello";
const MISSING = "f".repeat(24);
const PUBLIC_KEYS = [
  "branch",
  "chunkCount",
  "commitSha",
  "createdAt",
  "error",
  "fileCount",
  "id",
  "name",
  "owner",
  "progress",
  "status",
];

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
const seed = (userId, over = {}) =>
  fakeRepo.create({
    userId,
    owner: "octo",
    name: "hello",
    ownerLower: "octo",
    nameLower: "hello",
    status: "ready",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...over,
  });

beforeEach(async () => {
  resetIngestModels();
  startIngest.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  a1 = await agentFor("one@example.com");
  a2 = await agentFor("two@example.com");
});
afterEach(() => vi.restoreAllMocks());

describe("auth", () => {
  it.each([
    ["post", "/api/repos"],
    ["get", "/api/repos"],
    ["get", `/api/repos/${MISSING}`],
    ["delete", `/api/repos/${MISSING}`],
  ])("%s %s without a cookie is 401", async (method, path) => {
    const res = await request(app)[method](path).send({ url: URL1 });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
    expect(startIngest).not.toHaveBeenCalled();
  });
});

describe("POST /api/repos", () => {
  it("responds 202 with the safe public shape", async () => {
    startIngest.mockResolvedValue(await seed(U1, { status: "queued" }));
    const res = await a1.post("/api/repos").send({ url: URL1 });
    expect(res.status).toBe(202);
    expect(Object.keys(res.body.repo).sort()).toEqual(PUBLIC_KEYS);
    expect(res.body.repo).toMatchObject({
      owner: "octo",
      name: "hello",
      status: "queued",
      progress: { embedded: 0, total: 0 },
      error: null,
    });
    expect(startIngest).toHaveBeenCalledWith({ userId: U1, url: URL1 });
  });

  it.each([[{}], [{ url: 42 }], [{ url: "   " }]])(
    "400 VALIDATION_ERROR for %j, startIngest not called",
    async (body) => {
      const res = await a1.post("/api/repos").send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(startIngest).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["INVALID_URL", 400],
    ["REPO_EXISTS", 409],
    ["INGEST_IN_PROGRESS", 409],
    ["REPO_LIMIT_REACHED", 409],
    ["BUSY", 503],
  ])("maps IngestError %s to %i", async (code, status) => {
    startIngest.mockRejectedValue(new IngestError(code, "fixed message"));
    const res = await a1.post("/api/repos").send({ url: URL1 });
    expect(res.status).toBe(status);
    expect(res.body.error).toEqual({ code, message: "fixed message" });
    if (code === "BUSY") expect(res.headers["retry-after"]).toBe("60");
  });

  it.each([
    ["INVALID_URL", 400],
    ["REPO_NOT_FOUND", 404],
    ["RATE_LIMITED", 503],
    ["UPSTREAM_ERROR", 502],
  ])("maps GithubError %s to %i", async (code, status) => {
    startIngest.mockRejectedValue(new GithubError(code, "fixed message"));
    const res = await a1.post("/api/repos").send({ url: URL1 });
    expect(res.status).toBe(status);
    expect(res.body.error.code).toBe(code);
    if (code === "RATE_LIMITED") expect(res.headers["retry-after"]).toBe("60");
  });

  it("unknown errors become a generic 500 with no details", async () => {
    startIngest.mockRejectedValue(new Error("boom mongodb+srv://u:secret@h"));
    const res = await a1.post("/api/repos").send({ url: URL1 });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL");
    expect(JSON.stringify(res.body)).not.toContain("secret");
  });
});

describe("GET /api/repos", () => {
  it("lists only the caller's repos, newest first", async () => {
    await seed(U1, {
      name: "old",
      nameLower: "old",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    await seed(U1, {
      name: "new",
      nameLower: "new",
      createdAt: new Date("2026-02-01T00:00:00Z"),
    });
    await seed(U2, { name: "theirs", nameLower: "theirs" });
    const res = await a1.get("/api/repos");
    expect(res.status).toBe(200);
    expect(res.body.repos.map((r) => r.name)).toEqual(["new", "old"]);
    for (const r of res.body.repos)
      expect(Object.keys(r).sort()).toEqual(PUBLIC_KEYS);
  });

  it("returns an empty list for a new user", async () => {
    const res = await a2.get("/api/repos");
    expect(res.body).toEqual({ repos: [] });
  });
});

describe("GET /api/repos/:id", () => {
  it("returns progress and error for polling", async () => {
    const r = await seed(U1, {
      status: "failed",
      progress: { embedded: 32, total: 70 },
      error: { code: "QUOTA_EXHAUSTED", message: "used up" },
    });
    const res = await a1.get(`/api/repos/${r._id}`);
    expect(res.status).toBe(200);
    expect(res.body.repo.progress).toEqual({ embedded: 32, total: 70 });
    expect(res.body.repo.error).toEqual({
      code: "QUOTA_EXHAUSTED",
      message: "used up",
    });
  });

  it("another user's repo is 404, identical to a missing one", async () => {
    const r = await seed(U1);
    const theirs = await a2.get(`/api/repos/${r._id}`);
    const missing = await a2.get(`/api/repos/${MISSING}`);
    expect(theirs.status).toBe(404);
    expect(theirs.body).toEqual(missing.body);
    expect(theirs.body.error.code).toBe("REPO_NOT_FOUND");
  });

  it.each(["abc", "123", "g".repeat(24), "a".repeat(25)])(
    "invalid id %s is 400",
    async (id) => {
      const res = await a1.get(`/api/repos/${id}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_ID");
    },
  );
});

describe("DELETE /api/repos/:id", () => {
  it("deletes the repo and only its chunks", async () => {
    const r = await seed(U1);
    const other = await seed(U1, { name: "keep", nameLower: "keep" });
    chunks.push(
      { _id: "c1", repoId: r._id },
      { _id: "c2", repoId: r._id },
      { _id: "c3", repoId: other._id },
    );
    const res = await a1.delete(`/api/repos/${r._id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(repos.map((x) => x._id)).toEqual([other._id]);
    expect(chunks.map((c) => c._id)).toEqual(["c3"]);
    await a1.get(`/api/repos/${r._id}`).expect(404);
  });

  it("can delete a failed repo", async () => {
    const r = await seed(U1, { status: "failed" });
    await a1.delete(`/api/repos/${r._id}`).expect(200);
    expect(repos).toHaveLength(0);
  });

  it.each(["queued", "indexing"])(
    "%s repo is 409 INGEST_IN_PROGRESS and nothing is deleted",
    async (status) => {
      const r = await seed(U1, { status });
      chunks.push({ _id: "c1", repoId: r._id });
      const res = await a1.delete(`/api/repos/${r._id}`);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("INGEST_IN_PROGRESS");
      expect(repos).toHaveLength(1);
      expect(chunks).toHaveLength(1);
    },
  );

  it("another user's repo is 404 and untouched", async () => {
    const r = await seed(U1);
    chunks.push({ _id: "c1", repoId: r._id });
    const res = await a2.delete(`/api/repos/${r._id}`);
    expect(res.status).toBe(404);
    expect(repos).toHaveLength(1);
    expect(chunks).toHaveLength(1);
  });

  it("missing id is 404, malformed id is 400", async () => {
    await a1.delete(`/api/repos/${MISSING}`).expect(404);
    await a1.delete("/api/repos/nope").expect(400);
  });
});

describe("no internal fields", () => {
  it("never appears in any response body", async () => {
    const r = await seed(U1, { isDemo: false });
    startIngest.mockResolvedValue(r);
    const bodies = [
      (await a1.post("/api/repos").send({ url: URL1 })).body,
      (await a1.get("/api/repos")).body,
      (await a1.get(`/api/repos/${r._id}`)).body,
    ];
    const dump = JSON.stringify(bodies);
    for (const f of [
      "userId",
      "ownerLower",
      "nameLower",
      "usage",
      "isDemo",
      "expiresAt",
      "_id",
      "embedding",
    ])
      expect(dump).not.toContain(`"${f}"`);
  });
});
