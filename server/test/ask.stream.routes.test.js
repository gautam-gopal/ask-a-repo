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
  generateStream: vi.fn(),
}));

import { config } from "../src/config.js";
import { retrieve } from "../src/services/retrieve.js";
import { generateStream, LlmError } from "../src/services/llm.js";
import { EmbeddingError } from "../src/services/embeddings.js";
import { fakeRepo, messages, resetIngestModels } from "./fakeIngestModels.js";
import { makeApp } from "./app.js";

const app = makeApp();
const U1 = "0".repeat(23) + "1";
const SHA = "a".repeat(40);
const MISSING = "f".repeat(24);
const PASSWORD = "correct-horse-1";

let a1;
let a2;
async function agentFor(email) {
  const a = request.agent(app);
  await a
    .post("/api/auth/signup")
    .send({ email, password: PASSWORD })
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
const hit = (over = {}) => ({
  path: "src/auth.js",
  startLine: 1,
  endLine: 40,
  text: "code",
  score: 0.9,
  mergedFrom: 1,
  ...over,
});
const textParser = (res, cb) => {
  let d = "";
  res.setEncoding("utf8");
  res.on("data", (c) => (d += c));
  res.on("end", () => cb(null, d));
};
const parseEvents = (text) =>
  text
    .split("\n\n")
    .filter((b) => b.trim() && !b.startsWith(":"))
    .map((block) => {
      const ev = {};
      for (const l of block.split("\n")) {
        if (l.startsWith("event: ")) ev.event = l.slice(7);
        else if (l.startsWith("data: ")) ev.data = JSON.parse(l.slice(6));
      }
      return ev;
    });
const BODY = { question: "where is auth" };
const post = (agent, id, body = BODY) =>
  agent.post(`/api/repos/${id}/ask/stream`).send(body);
const stream = (agent, id, body = BODY) =>
  post(agent, id, body).buffer(true).parse(textParser);
const fakeStream =
  (tokens, text) =>
  async ({ onToken }) => {
    for (const t of tokens) onToken(t);
    return {
      text,
      model: "openai/gpt-oss-120b",
      usedFallback: false,
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    };
  };

beforeEach(async () => {
  resetIngestModels();
  retrieve.mockReset();
  generateStream.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  a1 = await agentFor("one@example.com");
  a2 = await agentFor("two@example.com");
});
afterEach(() => vi.restoreAllMocks());

describe("errors before the stream are plain JSON", () => {
  it("401 without a cookie", async () => {
    const res = await request(app)
      .post(`/api/repos/${MISSING}/ask/stream`)
      .send(BODY);
    expect(res.status).toBe(401);
    expect(res.headers["content-type"]).toMatch(/json/);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it.each([
    [{}],
    [{ question: 5 }],
    [{ question: "   " }],
    [{ question: "x".repeat(501) }],
  ])("400 VALIDATION_ERROR for %j", async (body) => {
    const r = await seed();
    const res = await post(a1, r._id, body);
    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toMatch(/json/);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("another user's repo is 404, identical to a missing one", async () => {
    const r = await seed();
    const theirs = await post(a2, r._id);
    const missing = await post(a2, MISSING);
    expect(theirs.status).toBe(404);
    expect(theirs.headers["content-type"]).toMatch(/json/);
    expect(theirs.body).toEqual(missing.body);
    expect(retrieve).not.toHaveBeenCalled();
    expect(generateStream).not.toHaveBeenCalled();
  });

  it.each(["queued", "indexing", "failed"])(
    "%s repo is 409 REPO_NOT_READY",
    async (status) => {
      const r = await seed({ status });
      const res = await post(a1, r._id);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("REPO_NOT_READY");
      expect(retrieve).not.toHaveBeenCalled();
    },
  );

  it("a retrieval failure is a JSON error, not a stream", async () => {
    const r = await seed();
    retrieve.mockRejectedValue(new EmbeddingError("QUOTA_EXHAUSTED", "x"));
    const res = await post(a1, r._id);
    expect(res.status).toBe(503);
    expect(res.headers["content-type"]).toMatch(/json/);
    expect(res.body.error.code).toBe("QUOTA_EXHAUSTED");
    expect(messages).toHaveLength(0);
  });
});

describe("stream", () => {
  it("sends sources, tokens, then done; saves the cleaned answer", async () => {
    const r = await seed();
    retrieve.mockResolvedValue([hit()]);
    generateStream.mockImplementation(
      fakeStream(["Auth is in ", "a.js 【1】."], "Auth is in a.js 【1】."),
    );
    const res = await stream(a1, r._id);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
    expect(res.headers["content-type"]).toMatch(/utf-8/i);
    expect(res.headers["cache-control"]).toBe("no-cache, no-transform");
    expect(res.headers["x-accel-buffering"]).toBe("no");

    const events = parseEvents(res.body);
    expect(events.map((e) => e.event)).toEqual([
      "sources",
      "token",
      "token",
      "done",
    ]);
    const url = `https://github.com/octo/hello/blob/${SHA}/src/auth.js#L1-L40`;
    expect(events[0].data).toEqual({
      sources: [
        {
          n: 1,
          path: "src/auth.js",
          startLine: 1,
          endLine: 40,
          url,
          cited: false,
        },
      ],
    });
    expect(events[1].data).toEqual({ t: "Auth is in " });
    const done = events[3].data;
    expect(done.answer).toBe("Auth is in a.js [1].");
    expect(done).toMatchObject({
      notFound: false,
      model: "openai/gpt-oss-120b",
      usedFallback: false,
      usage: { totalTokens: 2 },
      sources: [{ n: 1, url, cited: true }],
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      _id: done.id,
      question: "where is auth",
      answer: "Auth is in a.js [1].",
      notFound: false,
    });
  });

  it("not-found sends only done, never calls the LLM, and is saved", async () => {
    const r = await seed();
    retrieve.mockResolvedValue([hit({ score: 0.1 })]);
    const res = await stream(a1, r._id, { question: "pasta recipe" });
    const events = parseEvents(res.body);
    expect(events.map((e) => e.event)).toEqual(["done"]);
    expect(events[0].data).toMatchObject({
      answer: null,
      notFound: true,
      sources: [],
      model: null,
      usedFallback: false,
    });
    expect(generateStream).not.toHaveBeenCalled();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ notFound: true, answer: null });
  });

  it("an error after tokens sends an error event, saves nothing, leaks nothing", async () => {
    const r = await seed();
    retrieve.mockResolvedValue([hit()]);
    generateStream.mockImplementation(async ({ onToken }) => {
      onToken("partial ");
      throw new LlmError("TIMEOUT", `LEAK ${config.GROQ_API_KEY}`);
    });
    const res = await stream(a1, r._id);
    expect(res.status).toBe(200);
    const events = parseEvents(res.body);
    expect(events.map((e) => e.event)).toEqual(["sources", "token", "error"]);
    expect(events[2].data).toEqual({
      code: "UPSTREAM_TIMEOUT",
      message: "The request took too long. Try again.",
    });
    expect(res.body).not.toContain("LEAK");
    expect(res.body).not.toContain(config.GROQ_API_KEY);
    expect(messages).toHaveLength(0);
  });

  it("an unknown error becomes a generic INTERNAL event", async () => {
    const r = await seed();
    retrieve.mockResolvedValue([hit()]);
    generateStream.mockRejectedValue(
      new Error("boom mongodb+srv://u:secret@h"),
    );
    const res = await stream(a1, r._id);
    const events = parseEvents(res.body);
    expect(events.at(-1)).toEqual({
      event: "error",
      data: { code: "INTERNAL", message: "Something went wrong" },
    });
    expect(res.body).not.toContain("secret");
    expect(messages).toHaveLength(0);
  });

  it("client abort stops the upstream call and saves nothing", async () => {
    const r = await seed();
    retrieve.mockResolvedValue([hit()]);
    let upstreamAborted = false;
    generateStream.mockImplementation(
      ({ onToken, signal }) =>
        new Promise((_resolve, reject) => {
          onToken("partial ");
          signal.addEventListener("abort", () => {
            upstreamAborted = true;
            reject(new LlmError("ABORTED", "cancelled"));
          });
        }),
    );
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "one@example.com", password: PASSWORD });
    const cookie = login.headers["set-cookie"][0].split(";")[0];
    const server = app.listen(0);
    const ctrl = new AbortController();
    try {
      const { port } = server.address();
      const res = await fetch(
        `http://127.0.0.1:${port}/api/repos/${r._id}/ask/stream`,
        {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify(BODY),
          signal: ctrl.signal,
        },
      );
      expect(res.status).toBe(200);
      await res.body.getReader().read(); // first bytes arrived
      ctrl.abort();
      await vi.waitFor(() => expect(upstreamAborted).toBe(true));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(messages).toHaveLength(0);
    } finally {
      server.closeAllConnections?.();
      server.close();
    }
  });
});
