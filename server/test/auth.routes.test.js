import { describe, it, expect } from "vitest";
import request from "supertest";
import { makeApp } from "./app.js";

const app = makeApp();
const creds = { email: "user@example.com", password: "correct-horse-1" };

const signup = (body = creds) =>
  request(app).post("/api/auth/signup").send(body);
const login = (body = creds) => request(app).post("/api/auth/login").send(body);
const tokenCookie = (res) =>
  (res.headers["set-cookie"] ?? []).find((c) => c.startsWith("token="));

describe("POST /api/auth/signup", () => {
  it("creates a user, normalises the email, sets a hardened cookie", async () => {
    const res = await signup({
      email: "  User@Example.COM ",
      password: creds.password,
    });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe("user@example.com");
    expect(JSON.stringify(res.body)).not.toContain("passwordHash");

    const cookie = tokenCookie(res);
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).not.toMatch(/Secure/i); // Secure only in production
  });

  it("signs the user in: the cookie works on /api/me", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/signup").send(creds).expect(201);
    const res = await agent.get("/api/me");
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(creds.email);
  });

  it("returns 409 for a duplicate email, even with different casing", async () => {
    await signup().expect(201);
    const res = await signup({
      email: "USER@example.com",
      password: "another-pass-1",
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("EMAIL_TAKEN");
  });

  it.each([
    ["invalid email", { email: "nope", password: creds.password }],
    ["short password", { email: creds.email, password: "short" }],
    [
      "password over 72 bytes",
      { email: creds.email, password: "a".repeat(73) },
    ],
    ["empty body", {}],
  ])("returns 400 for %s", async (_name, body) => {
    const res = await signup(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(tokenCookie(res)).toBeUndefined();
  });
});

describe("POST /api/auth/login", () => {
  it("logs in with correct credentials and sets the cookie", async () => {
    await signup().expect(201);
    const res = await login();
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(creds.email);
    expect(tokenCookie(res)).toBeDefined();
  });

  it("returns 401 for a wrong password", async () => {
    await signup().expect(201);
    const res = await login({ email: creds.email, password: "wrong-password" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
    expect(tokenCookie(res)).toBeUndefined();
  });

  it("returns the same 401 for an unknown email (no user enumeration)", async () => {
    await signup().expect(201);
    const wrongPw = await login({
      email: creds.email,
      password: "wrong-password",
    });
    const unknown = await login({
      email: "ghost@example.com",
      password: "whatever-1",
    });
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(wrongPw.body);
  });

  it("returns 400 when the password is empty", async () => {
    const res = await login({ email: creds.email, password: "" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("POST /api/auth/logout", () => {
  it("clears the cookie so /api/me is 401 again", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/signup").send(creds).expect(201);
    const out = await agent.post("/api/auth/logout");
    expect(out.status).toBe(200);
    expect(tokenCookie(out)).toMatch(/Expires=Thu, 01 Jan 1970/);
    await agent.get("/api/me").expect(401);
  });
});
