import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";

vi.mock("../src/models/Repo.js", async () => ({
  Repo: (await import("./fakeIngestModels.js")).fakeRepo,
}));
vi.mock("../src/models/Chunk.js", async () => ({
  Chunk: (await import("./fakeIngestModels.js")).fakeChunk,
}));
vi.mock("../src/services/retrieve.js", () => ({ retrieve: vi.fn() }));
vi.mock("../src/services/llm.js", async (importOriginal) => ({
  ...(await importOriginal()),
  generate: vi.fn(),
}));

import { retrieve } from "../src/services/retrieve.js";
import { generate, LlmError } from "../src/services/llm.js";
import { EmbeddingError } from "../src/services/embeddings.js";
import {
  fakeRepo,
  fakeMessage,
  chunks,
  messages,
  resetIngestModels,
} from "./fakeIngestModels.js";
import { makeApp } from "./app.js";
import { DEMO_MESSAGE_TTL_MS } from "../src/middleware/demo.js";

const app = makeApp();
const U1 = "0".repeat(23) + "1";
const SHA = "a".repeat(40);
const MISSING = "f".repeat(24);
const OTHER_REPO = "e".repeat(24);

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
const msg = (over = {}) =>
  fakeMessage.create({
    repoId: OTHER_REPO,
    userId: U1,
    question: "q",
    answer: "a",
    notFound: false,
    ...over,
  });
const hit = (over = {}) => ({
  path: "src/auth.js",
  startLine: 1,
  endLine: 40,
  text: "code",
  score: 0.9,
  mergedFrom: 1,
  ...over,
});
const reply = (text) => ({
  text,
  model: "openai/gpt-oss-120b",
  usedFallback: false,
  usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
});
const ask = (agent, id, body = { question: "where is auth" }) =>
  agent.post(`/api/repos/${id}/ask`).send(body);

beforeEach(async () => {
  resetIngestModels();
  retrieve.mockReset();
  generate.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  a1 = await agentFor("one@example.com");
  a2 = await agentFor("two@example.com");
});
afterEach(() => vi.restoreAllMocks());

describe("auth and validation", () => {
  it.each([
    ["post", `/api/repos/${MISSING}/ask`],
    ["get", `/api/repos/${MISSING}/messages`],
  ])("%s %s without a cookie is 401", async (method, path) => {
    const res = await request(app)[method](path).send({ question: "x" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
    expect(retrieve).not.toHaveBeenCalled();
  });

  it.each([
    [{}],
    [{ question: 5 }],
    [{ question: "   " }],
    [{ question: "x".repeat(501) }],
  ])("400 VALIDATION_ERROR for %j", async (body) => {
    const r = await seed();
    const res = await ask(a1, r._id, body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(retrieve).not.toHaveBeenCalled();
    expect(messages).toHaveLength(0);
  });
});

describe("ownership and readiness", () => {
  it("another user's repo is 404 on ask and messages, same as a missing one", async () => {
    const r = await seed();
    const askTheirs = await ask(a2, r._id);
    const askMissing = await ask(a2, MISSING);
    expect(askTheirs.status).toBe(404);
    expect(askTheirs.body).toEqual(askMissing.body);
    const msgTheirs = await a2.get(`/api/repos/${r._id}/messages`);
    const msgMissing = await a2.get(`/api/repos/${MISSING}/messages`);
    expect(msgTheirs.status).toBe(404);
    expect(msgTheirs.body).toEqual(msgMissing.body);
    expect(retrieve).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(messages).toHaveLength(0);
  });

  it("malformed id is 400 on messages", async () => {
    const res = await a1.get("/api/repos/nope/messages");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_ID");
  });

  it.each(["queued", "indexing", "failed"])(
    "%s repo is 409 REPO_NOT_READY",
    async (status) => {
      const r = await seed({ status });
      const res = await ask(a1, r._id);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("REPO_NOT_READY");
      expect(retrieve).not.toHaveBeenCalled();
      expect(messages).toHaveLength(0);
    },
  );
});

describe("POST /api/repos/:id/ask", () => {
  it("returns and saves a normal answer", async () => {
    const r = await seed();
    retrieve.mockResolvedValue([hit()]);
    generate.mockResolvedValue(reply("Auth is in src/auth.js [1]."));
    const res = await ask(a1, r._id, { question: "  where is auth  " });
    expect(res.status).toBe(200);
    expect(retrieve).toHaveBeenCalledWith({
      repoId: r._id,
      query: "where is auth",
    });
    const sources = [
      {
        n: 1,
        path: "src/auth.js",
        startLine: 1,
        endLine: 40,
        url: `https://github.com/octo/hello/blob/${SHA}/src/auth.js#L1-L40`,
        cited: true,
      },
    ];
    expect(res.body).toEqual({
      id: expect.any(String),
      answer: "Auth is in src/auth.js [1].",
      notFound: false,
      sources,
      model: "openai/gpt-oss-120b",
      usedFallback: false,
      repo: { id: String(r._id), commitSha: SHA },
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      _id: res.body.id,
      repoId: r._id,
      userId: U1,
      question: "where is auth",
      answer: "Auth is in src/auth.js [1].",
      notFound: false,
      sources,
      model: "openai/gpt-oss-120b",
      usedFallback: false,
    });
    expect(messages[0].expiresAt.getTime()).toBe(r.expiresAt.getTime());
  });

  it("demo repo messages expire after 24 hours", async () => {
    const r = await seed({ isDemo: true });
    retrieve.mockResolvedValue([hit()]);
    generate.mockResolvedValue(reply("ok [1]"));
    await ask(a1, r._id).expect(200);
    const ms = messages[0].expiresAt.getTime() - Date.now();
    expect(ms).toBeGreaterThan(DEMO_MESSAGE_TTL_MS - 5000);
    expect(ms).toBeLessThanOrEqual(DEMO_MESSAGE_TTL_MS);
  });

  it("not-found path returns notFound true, never calls the LLM, and is saved", async () => {
    const r = await seed();
    retrieve.mockResolvedValue([hit({ score: 0.1 })]); // below SEARCH_MIN_SCORE (0.6 in tests)
    const res = await ask(a1, r._id, { question: "pasta recipe" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      answer: null,
      notFound: true,
      sources: [],
      model: null,
      usedFallback: false,
    });
    expect(generate).not.toHaveBeenCalled();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ notFound: true, answer: null });
  });

  it("passes the last 4 answered turns of this repo, oldest first, to the prompt", async () => {
    const r = await seed();
    for (let i = 1; i <= 6; i++)
      await msg({
        repoId: r._id,
        question: `old-${i}`,
        answer: `answer-${i}`,
        createdAt: new Date(2026, 0, i),
      });
    await msg({
      repoId: r._id,
      question: "nf-question",
      answer: null,
      notFound: true,
      createdAt: new Date(2026, 0, 20),
    });
    await msg({
      repoId: OTHER_REPO,
      question: "other-repo-q",
      createdAt: new Date(2026, 0, 21),
    });
    retrieve.mockResolvedValue([hit()]);
    generate.mockResolvedValue(reply("ok [1]"));
    await ask(a1, r._id, { question: "follow up" }).expect(200);
    const prompt = generate.mock.calls[0][0].messages[1].content;
    for (const n of [3, 4, 5, 6]) expect(prompt).toContain(`Q: old-${n}`);
    for (const s of ["old-1", "old-2", "nf-question", "other-repo-q"])
      expect(prompt).not.toContain(s);
    expect(prompt.indexOf("old-3")).toBeLessThan(prompt.indexOf("old-6"));
    expect(prompt).toContain("Question: follow up");
  });

  it.each([
    ["QUOTA_EXHAUSTED", {}, 503, "QUOTA_EXHAUSTED", undefined],
    [
      "RATE_LIMITED",
      { retryAfterMs: 7000 },
      503,
      "EMBEDDING_RATE_LIMITED",
      "7",
    ],
    ["RATE_LIMITED", {}, 503, "EMBEDDING_RATE_LIMITED", "60"],
    ["AUTH_FAILED", {}, 500, "INTERNAL", undefined],
    ["TIMEOUT", {}, 504, "UPSTREAM_TIMEOUT", undefined],
    ["UPSTREAM_ERROR", {}, 502, "ANSWER_FAILED", undefined],
    ["BAD_RESPONSE", {}, 502, "ANSWER_FAILED", undefined],
  ])(
    "maps EmbeddingError %s %j to %i %s",
    async (code, details, status, stored, retryAfter) => {
      const r = await seed();
      retrieve.mockRejectedValue(
        new EmbeddingError(code, "LEAK test-cf-token-not-real", details),
      );
      const res = await ask(a1, r._id);
      expect(res.status).toBe(status);
      expect(res.body.error.code).toBe(stored);
      expect(res.headers["retry-after"]).toBe(retryAfter);
      expect(JSON.stringify(res.body)).not.toContain("LEAK");
      expect(messages).toHaveLength(0);
      expect(generate).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["RATE_LIMITED", { retryAfterSeconds: 12 }, 503, "LLM_RATE_LIMITED", "12"],
    ["RATE_LIMITED", {}, 503, "LLM_RATE_LIMITED", "60"],
    ["AUTH_FAILED", {}, 500, "INTERNAL", undefined],
    ["TIMEOUT", {}, 504, "UPSTREAM_TIMEOUT", undefined],
    ["MODEL_UNAVAILABLE", {}, 502, "ANSWER_FAILED", undefined],
    ["BAD_RESPONSE", {}, 502, "ANSWER_FAILED", undefined],
    ["UPSTREAM_ERROR", {}, 502, "ANSWER_FAILED", undefined],
  ])(
    "maps LlmError %s %j to %i %s",
    async (code, details, status, stored, retryAfter) => {
      const r = await seed();
      retrieve.mockResolvedValue([hit()]);
      generate.mockRejectedValue(
        new LlmError(code, "LEAK test-groq-key-not-real", details),
      );
      const res = await ask(a1, r._id);
      expect(res.status).toBe(status);
      expect(res.body.error.code).toBe(stored);
      expect(res.headers["retry-after"]).toBe(retryAfter);
      expect(JSON.stringify(res.body)).not.toContain("LEAK");
      expect(messages).toHaveLength(0);
    },
  );

  it("AUTH_FAILED is logged server-side without provider text", async () => {
    const r = await seed();
    retrieve.mockResolvedValue([hit()]);
    generate.mockRejectedValue(new LlmError("AUTH_FAILED", "LEAK"));
    const res = await ask(a1, r._id);
    expect(res.body.error.message).toBe("Something went wrong");
    expect(console.error).toHaveBeenCalled();
    expect(JSON.stringify(console.error.mock.calls)).not.toContain("LEAK");
  });

  it("unknown errors become a generic 500 and nothing is saved", async () => {
    const r = await seed();
    retrieve.mockRejectedValue(new Error("boom mongodb+srv://u:secret@h"));
    const res = await ask(a1, r._id);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL");
    expect(JSON.stringify(res.body)).not.toContain("secret");
    expect(messages).toHaveLength(0);
  });
});

describe("GET /api/repos/:id/messages", () => {
  it("returns the last 50, oldest first, allowlisted", async () => {
    const r = await seed();
    for (let i = 1; i <= 55; i++)
      await msg({
        repoId: r._id,
        question: `q${i}`,
        sources: [
          {
            n: 1,
            path: "a.js",
            startLine: 1,
            endLine: 2,
            url: "https://github.com/octo/hello/blob/x/a.js#L1-L2",
            cited: true,
          },
        ],
        model: "m",
        createdAt: new Date(2026, 0, 1, 0, 0, i),
      });
    await msg({ repoId: OTHER_REPO, question: "not-mine" });
    const res = await a1.get(`/api/repos/${r._id}/messages`);
    expect(res.status).toBe(200);
    const qs = res.body.messages.map((m) => m.question);
    expect(qs).toHaveLength(50);
    expect(qs[0]).toBe("q6");
    expect(qs[49]).toBe("q55");
    expect(Object.keys(res.body.messages[0]).sort()).toEqual([
      "answer",
      "createdAt",
      "id",
      "model",
      "notFound",
      "question",
      "sources",
      "usedFallback",
    ]);
    expect(Object.keys(res.body.messages[0].sources[0]).sort()).toEqual([
      "cited",
      "endLine",
      "n",
      "path",
      "startLine",
      "url",
    ]);
  });

  it("empty list for a repo with no messages", async () => {
    const r = await seed();
    const res = await a1.get(`/api/repos/${r._id}/messages`);
    expect(res.body).toEqual({ messages: [] });
  });
});

describe("DELETE removes messages", () => {
  it("deletes this repo's messages and only those", async () => {
    const r = await seed();
    chunks.push({ _id: "c1", repoId: r._id });
    await msg({ repoId: r._id, question: "mine-1" });
    await msg({ repoId: r._id, question: "mine-2" });
    await msg({ repoId: OTHER_REPO, question: "keep" });
    await a1.delete(`/api/repos/${r._id}`).expect(200);
    expect(messages.map((m) => m.question)).toEqual(["keep"]);
  });
});

describe("no internal fields", () => {
  it("never appears in ask or messages responses", async () => {
    const r = await seed();
    retrieve.mockResolvedValue([hit()]);
    generate.mockResolvedValue(reply("ok [1]"));
    const dump = JSON.stringify([
      (await ask(a1, r._id)).body,
      (await a1.get(`/api/repos/${r._id}/messages`)).body,
    ]);
    for (const f of [
      "userId",
      "repoId",
      "_id",
      "expiresAt",
      "embedding",
      "score",
      "text",
    ])
      expect(dump).not.toContain(`"${f}"`);
  });
});
