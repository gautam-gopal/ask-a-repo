import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("../src/models/Repo.js", async () => ({
  Repo: (await import("./fakeIngestModels.js")).fakeRepo,
}));
vi.mock("../src/models/Chunk.js", async () => ({
  Chunk: (await import("./fakeIngestModels.js")).fakeChunk,
}));
vi.mock("../src/services/retrieve.js", () => ({ retrieve: vi.fn() }));

import { config } from "../src/config.js";
import { retrieve } from "../src/services/retrieve.js";
import { limits, resetRateLimits } from "../src/middleware/rateLimit.js";
import { capLimits } from "../src/middleware/signupCap.js";
import { sink } from "../src/middleware/requestLog.js";
import { errorHandler } from "../src/middleware/errors.js";
import { redact } from "../src/redact.js";
import {
  budgets,
  recordNeurons,
  recordLlm,
  assertNeurons,
  getToday,
} from "../src/services/usage.js";
import { fakeRepo, resetIngestModels } from "./fakeIngestModels.js";
import { setUsage } from "./fakeUsage.js";
import { makeApp } from "./app.js";

const app = makeApp();
const U1 = "0".repeat(23) + "1";
const MISSING = "f".repeat(24);
const Q = { question: "where is auth" };
const PASSWORD = "correct-horse-1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BASE = { ...limits };
const BASE_BUDGETS = { ...budgets };
const BASE_CAP = { ...capLimits };

const setLimits = (o) => {
  Object.assign(limits, o);
  resetRateLimits();
};
async function agentFor(email) {
  const a = request.agent(app);
  await a
    .post("/api/auth/signup")
    .send({ email, password: PASSWORD })
    .expect(201);
  return a;
}
const seedRepo = (over = {}) =>
  fakeRepo.create({
    userId: U1,
    owner: "octo",
    name: "hello",
    ownerLower: "octo",
    nameLower: "hello",
    status: "ready",
    commitSha: "a".repeat(40),
    ...over,
  });
const askPaths = (id) => [
  `/api/repos/${id}/ask`,
  `/api/repos/${id}/ask/stream`,
  `/api/repos/${id}/search`,
];

beforeEach(() => {
  resetIngestModels();
  Object.assign(budgets, BASE_BUDGETS);
  Object.assign(capLimits, BASE_CAP);
  retrieve.mockReset();
  setLimits(BASE);
});

describe("rate limits", () => {
  it("signup: 429 in the standard shape, with headers; other X-Forwarded-For is a separate bucket", async () => {
    setLimits({ signup: 2 });
    const post = (ip) =>
      request(app).post("/api/auth/signup").set("X-Forwarded-For", ip).send({});
    expect((await post("9.9.9.1")).status).toBe(400);
    expect((await post("9.9.9.1")).status).toBe(400);
    const res = await post("9.9.9.1");
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("TOO_MANY_REQUESTS");
    expect(res.body.error.message).toMatch(/Try again in/);
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
    expect(res.headers["ratelimit-limit"]).toBe("2");
    expect((await post("9.9.9.2")).status).toBe(400); // different IP, own bucket
  });

  it("login: only failures count", async () => {
    await agentFor("one@example.com");
    setLimits({ login: 2 });
    const login = (password) =>
      request(app)
        .post("/api/auth/login")
        .send({ email: "one@example.com", password });
    for (let i = 0; i < 3; i++)
      expect((await login(PASSWORD)).status).toBe(200);
    expect((await login("wrong-password")).status).toBe(401);
    expect((await login("wrong-password")).status).toBe(401);
    const res = await login("wrong-password");
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBeDefined();
  });

  it("ask, ask/stream and search share one per-user counter; other users are separate", async () => {
    const a1 = await agentFor("one@example.com");
    const a2 = await agentFor("two@example.com");
    setLimits({ askUser: 3 });
    const paths = askPaths(MISSING);
    for (const p of paths) expect((await a1.post(p).send(Q)).status).toBe(404);
    const res = await a1.post(paths[0]).send(Q);
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("TOO_MANY_REQUESTS");
    expect((await a2.post(paths[0]).send(Q)).status).toBe(404);
  });

  it("ask IP backstop is shared by all users on one IP", async () => {
    const a1 = await agentFor("one@example.com");
    const a2 = await agentFor("two@example.com");
    setLimits({ askIp: 2 });
    const p = askPaths(MISSING)[0];
    expect((await a1.post(p).send(Q)).status).toBe(404);
    expect((await a2.post(p).send(Q)).status).toBe(404);
    expect((await a1.post(p).send(Q)).status).toBe(429);
  });

  it("ingest: per user, and per IP across users", async () => {
    const a1 = await agentFor("one@example.com");
    const a2 = await agentFor("two@example.com");
    setLimits({ ingestUser: 1 });
    expect((await a1.post("/api/repos").send({ url: "bad" })).status).toBe(400);
    expect((await a1.post("/api/repos").send({ url: "bad" })).status).toBe(429);
    setLimits({ ingestIp: 1 });
    expect((await a1.post("/api/repos").send({ url: "bad" })).status).toBe(400);
    expect((await a2.post("/api/repos").send({ url: "bad" })).status).toBe(429);
  });

  it("polling reads are not limited by the ask limits or the general limiter", async () => {
    const a1 = await agentFor("one@example.com");
    const repo = await seedRepo();
    setLimits({ askUser: 1, general: 2 });
    const p = askPaths(MISSING)[0];
    await a1.post(p).send(Q);
    expect((await a1.post(p).send(Q)).status).toBe(429);
    for (let i = 0; i < 5; i++) {
      expect((await a1.get("/api/repos")).status).toBe(200);
      expect((await a1.get(`/api/repos/${repo._id}`)).status).toBe(200);
    }
  });

  it("general limiter: 300-style cap on /api, /healthz untouched", async () => {
    setLimits({ general: 2 });
    expect((await request(app).get("/api/me")).status).toBe(401);
    expect((await request(app).get("/api/me")).status).toBe(401);
    const res = await request(app).get("/api/me");
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("TOO_MANY_REQUESTS");
    expect((await request(app).get("/healthz")).status).toBe(200);
  });
});

describe("daily budget guard", () => {
  it("refuses ingest, ask and search when the budget is gone, but not reads", async () => {
    const a1 = await agentFor("one@example.com");
    const repo = await seedRepo();
    setUsage({ neurons: budgets.neurons, llmRequests: budgets.llm });
    const targets = [
      ...askPaths(repo._id).map((p) => [p, Q]),
      ["/api/repos", { url: "https://github.com/o/r" }],
    ];
    for (const [p, body] of targets) {
      const res = await a1.post(p).send(body);
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe("DAILY_BUDGET");
      expect(res.body.error.message).toMatch(/midnight UTC/);
    }
    expect((await a1.get("/api/repos")).status).toBe(200);
    expect((await a1.get(`/api/repos/${repo._id}`)).status).toBe(200);
    expect((await a1.get(`/api/repos/${repo._id}/messages`)).status).toBe(200);
  });

  it("LLM budget alone blocks ask but not search", async () => {
    const a1 = await agentFor("one@example.com");
    const repo = await seedRepo();
    retrieve.mockResolvedValue([]);
    setUsage({ llmRequests: budgets.llm });
    expect((await a1.post(askPaths(repo._id)[0]).send(Q)).status).toBe(503);
    expect((await a1.post(askPaths(repo._id)[2]).send(Q)).status).toBe(200);
  });

  it("records usage, and an ingest bigger than the remaining budget is refused", async () => {
    await recordNeurons(5);
    await recordNeurons(7);
    await recordLlm(2);
    expect(await getToday()).toEqual({ neurons: 12, llmRequests: 2 });
    budgets.neurons = 20;
    await expect(assertNeurons(8)).resolves.toBeUndefined();
    await expect(assertNeurons(9)).rejects.toMatchObject({
      code: "DAILY_BUDGET",
      status: 503,
    });
  });
});

describe("signup cap", () => {
  it("returns 503 SIGNUPS_CLOSED once MAX_USERS is reached", async () => {
    capLimits.maxUsers = 1;
    await request(app)
      .post("/api/auth/signup")
      .send({ email: "a@example.com", password: PASSWORD })
      .expect(201);
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ email: "b@example.com", password: PASSWORD });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("SIGNUPS_CLOSED");
  });
});

describe("request hardening", () => {
  it("413 in the standard shape for a body over 16 KB", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "a@example.com", password: "x".repeat(17000) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("client-caused 4xx is not a 500", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .set("Content-Encoding", "compress")
      .send("{}");

    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe("BAD_REQUEST");
  });

  it("helmet headers, strict CSP, request id, no x-powered-by", async () => {
    const res = await request(app).get("/api/me");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    const csp = res.headers["content-security-policy"];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("unsafe-inline");
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["x-request-id"]).toMatch(UUID);
  });

  it("unknown /api routes get a JSON 404", async () => {
    for (const res of [
      await request(app).get("/api/nope"),
      await request(app).post("/api/nope").send({}),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    }
  });

  it("the SPA fallback still serves index.html for non-API GETs", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dist-"));
    fs.writeFileSync(path.join(dir, "index.html"), "<html>spa-shell</html>");
    const spa = makeApp({ clientDist: dir });
    const page = await request(spa).get("/repos/abc");
    expect(page.status).toBe(200);
    expect(page.text).toContain("spa-shell");
    expect((await request(spa).get("/api/nope")).body.error.code).toBe(
      "NOT_FOUND",
    );
    expect((await request(spa).post("/anything").send({})).status).toBe(404);
  });
});

describe("logging", () => {
  it("logs method, route, status, duration, id and userId, and never secrets", async () => {
    const lines = [];
    const orig = sink.write;
    sink.write = (l) => lines.push(l);
    let me;
    try {
      const a1 = await agentFor("one@example.com");
      const repo = await seedRepo();
      me = await a1.get("/api/me?x=secret-query");
      await a1.get(`/api/repos/${repo._id}`);
      await request(app)
        .post("/api/auth/login")
        .set("Authorization", "Bearer abc.def.ghi")
        .set("Cookie", "token=SECRETCOOKIE")
        .send({ email: "zed@example.com", password: "hunter2-hunter2" });
    } finally {
      sink.write = orig;
    }
    const entries = lines.map((l) => JSON.parse(l));
    const mine = entries.find((e) => e.path === "/api/me");
    expect(mine).toMatchObject({ method: "GET", status: 200, userId: U1 });
    expect(typeof mine.ms).toBe("number");
    expect(mine.id).toBe(me.headers["x-request-id"]);
    expect(entries.some((e) => e.path === "/api/repos/:id")).toBe(true);
    const dump = lines.join("\n");
    for (const s of [
      "secret-query",
      "SECRETCOOKIE",
      "abc.def.ghi",
      "hunter2",
      "@example.com",
      PASSWORD,
    ])
      expect(dump).not.toContain(s);
  });

  it("redact() removes configured secrets, emails, connection strings and bearer tokens", () => {
    const out = redact(
      `a ${config.JWT_SECRET} ${config.GROQ_API_KEY} x@y.com mongodb+srv://u:pw@h/db Bearer abc.def token=zzz`,
    );
    for (const s of [
      config.JWT_SECRET,
      config.GROQ_API_KEY,
      "x@y.com",
      "u:pw",
      "abc.def",
      "zzz",
    ])
      expect(out).not.toContain(s);
  });

  it("the central error logger never prints secrets", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mini = express();
    mini.get("/boom", () => {
      throw new Error(
        `x ${config.JWT_SECRET} a@b.com mongodb+srv://u:pw@h/db Bearer abc.def`,
      );
    });
    mini.use(errorHandler);
    const res = await request(mini).get("/boom");
    const logged = JSON.stringify(spy.mock.calls);
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(res.body.error.message).toBe("Something went wrong");
    for (const s of [config.JWT_SECRET, "a@b.com", "u:pw", "abc.def"])
      expect(logged).not.toContain(s);
  });
});
