import { describe, it, expect } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { config } from "../src/config.js";
import { signToken } from "../src/middleware/auth.js";
import { User } from "../src/models/User.js";
import { resetUsers } from "./fakeUser.js";
import { makeApp } from "./app.js";

const app = makeApp();
const me = (token) => {
  const req = request(app).get("/api/me");
  return token === undefined ? req : req.set("Cookie", `token=${token}`);
};

describe("requireAuth (via GET /api/me)", () => {
  it("rejects a request with no cookie", async () => {
    const res = await me();
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects a garbage token", async () => {
    const res = await me("not-a-jwt");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects a token signed with the wrong secret", async () => {
    const user = await User.create({ email: "a@b.com", passwordHash: "x" });
    const forged = jwt.sign({}, "x".repeat(40), {
      algorithm: "HS256",
      subject: String(user._id),
    });
    const res = await me(forged);
    expect(res.status).toBe(401);
  });

  it("rejects an expired token", async () => {
    const user = await User.create({ email: "a@b.com", passwordHash: "x" });
    const expired = jwt.sign(
      { exp: Math.floor(Date.now() / 1000) - 10 },
      config.JWT_SECRET,
      { algorithm: "HS256", subject: String(user._id) },
    );
    const res = await me(expired);
    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/expired/i);
  });

  it("rejects a valid token whose user no longer exists", async () => {
    const user = await User.create({ email: "a@b.com", passwordHash: "x" });
    const token = signToken(user);
    resetUsers();
    const res = await me(token);
    expect(res.status).toBe(401);
  });

  it("accepts a valid token and returns the user without the hash", async () => {
    const user = await User.create({ email: "a@b.com", passwordHash: "x" });
    const res = await me(signToken(user));
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: String(user._id), email: "a@b.com" });
    expect(JSON.stringify(res.body)).not.toContain("passwordHash");
  });
});
