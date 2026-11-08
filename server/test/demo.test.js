import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

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
vi.mock("../src/services/ingest.js", async (importOriginal) => ({
  ...(await importOriginal()),
  startIngest: vi.fn(),
}));

import { config } from "../src/config.js";
import { User } from "../src/models/User.js";
import { retrieve } from "../src/services/retrieve.js";
import { generate } from "../src/services/llm.js";
import { startIngest } from "../src/services/ingest.js";
import {
  demo,
  DEMO_EMAIL,
  DEMO_MESSAGE_TTL_MS,
} from "../src/middleware/demo.js";
import { limits, resetRateLimits } from "../src/middleware/rateLimit.js";
import { sink } from "../src/middleware/requestLog.js";
import { redact } from "../src/redact.js";
import { planRepos } from "../src/services/demoSeed.js";
import {
  fakeRepo,
  fakeMessage,
  repos,
  messages,
  resetIngestModels,
} from "./fakeIngestModels.js";
import { makeApp } from "./app.js";

const app = makeApp();
const PW = "pw-correct-1234";
const Q = { question: "where is auth" };
const MISSING = "f".repeat(24);
const BASE = { ...limits };
const setLimits = (o) => {
  Object.assign(limits, o);
  resetRateLimits();
};
const tokenOf = (res) =>
  /token=([^;]+)/.exec((res.headers["set-cookie"] ?? []).join(";"))?.[1];
const makeDemoUser = () =>
  User.create({
    email: DEMO_EMAIL,
    passwordHash: bcrypt.hashSync(PW, 4),
    isDemo: true,
  });
async function normalAgent(email = "one@example.com") {
  const a = request.agent(app);
  await a.post("/api/auth/signup").send({ email, password: PW }).expect(201);
  return a;
}
async function demoAgent(ip = "7.7.7.1") {
  const a = request.agent(app);
  await a.post("/api/auth/demo").set("X-Forwarded-For", ip).expect(200);
  return a;
}
const seedRepo = (userId, over = {}) =>
  fakeRepo.create({
    userId,
    owner: "octo",
    name: "hello",
    ownerLower: "octo",
    nameLower: "hello",
    status: "ready",
    commitSha: "a".repeat(40),
    isDemo: true,
    ...over,
  });
const hit = {
  path: "a.js",
  startLine: 1,
  endLine: 5,
  text: "code",
  score: 0.9,
  mergedFrom: 1,
};
const reply = { text: "ok [1]", model: "m", usedFallback: false, usage: null };

beforeEach(() => {
  resetIngestModels();
  demo.enabled = true;
  setLimits(BASE);
  retrieve.mockReset();
  generate.mockReset();
  startIngest.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("GET /api/config and POST /api/auth/demo", () => {
  it("disabled: config says false and the demo route is a 404 with no cookie", async () => {
    demo.enabled = false;
    await makeDemoUser();
    expect((await request(app).get("/api/config")).body).toEqual({
      demoEnabled: false,
    });
    const res = await request(app).post("/api/auth/demo");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect(tokenOf(res)).toBeUndefined();
  });

  it("enabled: config says true", async () => {
    expect((await request(app).get("/api/config")).body).toEqual({
      demoEnabled: true,
    });
  });

  it("sets a 2 hour cookie for the demo user, with no credentials sent", async () => {
    await normalAgent("other@example.com"); // a normal user exists and must not be reachable
    const demoUser = await makeDemoUser();
    const res = await request(app).post("/api/auth/demo");
    expect(res.status).toBe(200);
    const cookie = res.headers["set-cookie"].find((c) =>
      c.startsWith("token="),
    );
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Max-Age=7200/);
    const payload = jwt.decode(tokenOf(res));
    expect(payload.sub).toBe(String(demoUser._id));
    expect(payload.exp - payload.iat).toBe(7200);
    expect(res.body.user.email).toBe(DEMO_EMAIL);
    expect(JSON.stringify(res.body)).not.toContain("passwordHash");
  });

  it("/api/me tells the client it is a demo session", async () => {
    await makeDemoUser();
    const me = await (await demoAgent()).get("/api/me");
    expect(me.body.demo).toBe(true);
    expect(me.body.user.email).toBe(DEMO_EMAIL);
    expect((await (await normalAgent()).get("/api/me")).body.demo).toBe(false);
  });

  it("503 when no demo user is seeded, and a normal user is never logged in", async () => {
    await normalAgent();
    const res = await request(app).post("/api/auth/demo");
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("DEMO_UNAVAILABLE");
    expect(tokenOf(res)).toBeUndefined();
  });

  it("is rate limited per IP in the standard 429 shape", async () => {
    await makeDemoUser();
    setLimits({ demo: 2 });
    const go = (ip) =>
      request(app).post("/api/auth/demo").set("X-Forwarded-For", ip);
    expect((await go("5.5.5.1")).status).toBe(200);
    expect((await go("5.5.5.1")).status).toBe(200);
    const res = await go("5.5.5.1");
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("TOO_MANY_REQUESTS");
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
    expect((await go("5.5.5.2")).status).toBe(200);
  });
});

describe("demo account cannot be taken over", () => {
  it("signup with the demo email is the normal 409, before and after seeding", async () => {
    const signup = () =>
      request(app)
        .post("/api/auth/signup")
        .send({ email: DEMO_EMAIL, password: PW });
    let res = await signup();
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("EMAIL_TAKEN");
    expect(tokenOf(res)).toBeUndefined();
    await makeDemoUser();
    expect((await signup()).status).toBe(409);
  });

  it("login cannot be used on the demo account", async () => {
    await makeDemoUser();
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: DEMO_EMAIL, password: PW });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
    expect(tokenOf(res)).toBeUndefined();
  });
});

describe("read-only guard", () => {
  it("403 on add and delete for the demo user; reads and ask still work", async () => {
    const u = await makeDemoUser();
    const repo = await seedRepo(u._id);
    retrieve.mockResolvedValue([hit]);
    generate.mockResolvedValue(reply);
    const a = await demoAgent();

    const add = await a
      .post("/api/repos")
      .send({ url: "https://github.com/o/r" });
    expect(add.status).toBe(403);
    expect(add.body.error).toEqual({
      code: "DEMO_READ_ONLY",
      message:
        "The demo account is read-only. Sign up to add your own repository.",
    });
    const del = await a.delete(`/api/repos/${repo._id}`);
    expect(del.status).toBe(403);
    expect(del.body.error.code).toBe("DEMO_READ_ONLY");
    expect(startIngest).not.toHaveBeenCalled();
    expect(repos).toHaveLength(1);

    expect((await a.get("/api/repos")).status).toBe(200);
    expect((await a.post(`/api/repos/${repo._id}/ask`).send(Q)).status).toBe(
      200,
    );
  });

  it("does not affect normal users", async () => {
    const a = await normalAgent();
    const id = (await a.get("/api/me")).body.user.id;
    startIngest.mockResolvedValue(
      await seedRepo(id, { isDemo: false, status: "queued" }),
    );
    expect(
      (await a.post("/api/repos").send({ url: "https://github.com/o/r" }))
        .status,
    ).toBe(202);
    const mine = await seedRepo(id, {
      isDemo: false,
      name: "x",
      nameLower: "x",
    });
    expect((await a.delete(`/api/repos/${mine._id}`)).status).toBe(200);
  });
});

describe("demo ask: privacy and TTL", () => {
  it("never shows or feeds earlier questions; messages expire in 24 hours", async () => {
    const u = await makeDemoUser();
    const repo = await seedRepo(u._id);
    await fakeMessage.create({
      repoId: repo._id,
      userId: u._id,
      question: "SECRET-Q",
      answer: "SECRET-A",
      notFound: false,
    });
    retrieve.mockResolvedValue([hit]);
    generate.mockResolvedValue(reply);
    const a = await demoAgent("7.7.7.1");
    const b = await demoAgent("7.7.7.2");

    expect((await a.post(`/api/repos/${repo._id}/ask`).send(Q)).status).toBe(
      200,
    );
    const prompt = generate.mock.calls[0][0].messages[1].content;
    expect(prompt).not.toContain("SECRET");
    expect(prompt).toContain("Question: where is auth");

    expect((await a.get(`/api/repos/${repo._id}/messages`)).body).toEqual({
      messages: [],
    });
    expect((await b.get(`/api/repos/${repo._id}/messages`)).body).toEqual({
      messages: [],
    });

    const saved = messages.at(-1);
    expect(saved.question).toBe("where is auth");
    const ms = saved.expiresAt.getTime() - Date.now();
    expect(ms).toBeGreaterThan(DEMO_MESSAGE_TTL_MS - 5000);
    expect(ms).toBeLessThanOrEqual(DEMO_MESSAGE_TTL_MS);
  });
});

describe("ask limiter key", () => {
  const ask = (ag, ip) =>
    ag.post(`/api/repos/${MISSING}/ask`).set("X-Forwarded-For", ip).send(Q);

  it("demo sessions are keyed by IP", async () => {
    await makeDemoUser();
    setLimits({ askUser: 1 });
    const a = await demoAgent();
    expect((await ask(a, "8.8.8.1")).status).toBe(404);
    expect((await ask(a, "8.8.8.1")).status).toBe(429);
    expect((await ask(a, "8.8.8.2")).status).toBe(404); // same demo user, other IP
  });

  it("normal users are keyed by user", async () => {
    const a1 = await normalAgent("one@example.com");
    const a2 = await normalAgent("two@example.com");
    setLimits({ askUser: 1 });
    expect((await ask(a1, "8.8.8.1")).status).toBe(404);
    expect((await ask(a1, "8.8.8.1")).status).toBe(429);
    expect((await ask(a2, "8.8.8.1")).status).toBe(404); // same IP, other user
  });
});

describe("secrets", () => {
  it("the demo password is never in responses, logs or redacted output", async () => {
    const lines = [];
    const orig = sink.write;
    sink.write = (l) => lines.push(l);
    let bodies;
    try {
      await makeDemoUser();
      const res = await request(app).post("/api/auth/demo");
      const me = await (await demoAgent()).get("/api/me");
      bodies = JSON.stringify([res.body, me.body]);
    } finally {
      sink.write = orig;
    }
    expect(config.DEMO_PASSWORD).toBeTruthy();
    for (const dump of [bodies, lines.join("\n")]) {
      expect(dump).not.toContain(config.DEMO_PASSWORD);
      expect(dump).not.toContain("passwordHash");
    }
    expect(redact(`x ${config.DEMO_PASSWORD} y`)).not.toContain(
      config.DEMO_PASSWORD,
    );
  });
});

describe("config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("DEMO_ENABLED=true without DEMO_PASSWORD stops the boot", async () => {
    vi.resetModules();
    vi.stubEnv("DEMO_ENABLED", "true");
    vi.stubEnv("DEMO_PASSWORD", "");
    vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    await expect(import("../src/config.js")).rejects.toThrow("exit");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("DEMO_PASSWORD"),
    );
  });

  it("DEMO_ENABLED=true with a long enough password is accepted", async () => {
    vi.resetModules();
    vi.stubEnv("DEMO_ENABLED", "true");
    vi.stubEnv("DEMO_PASSWORD", "a-long-demo-password");
    const { config: c } = await import("../src/config.js");
    expect(c.DEMO_ENABLED).toBe(true);
  });
});

describe("planRepos (seed idempotency)", () => {
  const A = "https://github.com/octo/hello";
  const B = "https://github.com/octo/other";
  const row = (nameLower, status, isDemo = true) => ({
    ownerLower: "octo",
    nameLower,
    status,
    isDemo,
  });
  const actions = (urls, existing) =>
    planRepos(urls, existing).map((p) => p.action);

  it("ingests both on an empty database", () => {
    expect(actions([A, B], [])).toEqual(["ingest", "ingest"]);
  });
  it("a re-run does nothing when both are ready", () => {
    expect(
      actions([A, B], [row("hello", "ready"), row("other", "ready")]),
    ).toEqual(["skip", "skip"]);
  });
  it("retries failed, replaces stuck or non-demo repos", () => {
    expect(
      actions([A, B], [row("hello", "failed"), row("other", "ready", false)]),
    ).toEqual(["ingest", "replace"]);
    expect(actions([A, B], [row("hello", "indexing")])).toEqual([
      "replace",
      "ingest",
    ]);
  });
  it("matches regardless of URL casing", () => {
    expect(
      actions(["https://github.com/Octo/Hello", B], [row("hello", "ready")]),
    ).toEqual(["skip", "ingest"]);
  });
  it("rejects bad input", () => {
    expect(() => planRepos([A], [])).toThrow(RangeError);
    expect(() =>
      planRepos([A, A.toUpperCase().replace("HTTPS", "https")], []),
    ).toThrow();
    expect(() => planRepos(["http://evil.com/o/r", B], [])).toThrow();
  });
});
