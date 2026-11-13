import { describe, it, expect } from "vitest";
import { validateAuth } from "../../client/src/authHelpers.js";

describe("validateAuth", () => {
  it("accepts valid login and signup input", () => {
    expect(validateAuth("login", "a@b.co", "x")).toEqual({});
    expect(validateAuth("signup", "a@b.co", "12345678")).toEqual({});
  });

  it.each([[""], ["nope"], ["a@b"], ["a b@c.co"], [`${"a".repeat(250)}@b.co`]])(
    "rejects email %j",
    (email) => {
      expect(validateAuth("login", email, "x").email).toMatch(/valid email/);
    },
  );

  it("login only requires a password", () => {
    expect(validateAuth("login", "a@b.co", "").password).toMatch(/Enter your/);
    expect(validateAuth("login", "a@b.co", "x")).toEqual({});
  });

  it("signup enforces 8 characters and 72 bytes", () => {
    expect(validateAuth("signup", "a@b.co", "short").password).toMatch(/8/);
    expect(validateAuth("signup", "a@b.co", "é".repeat(37)).password).toMatch(
      /72 bytes/,
    ); // 37 characters, 74 bytes
    expect(validateAuth("signup", "a@b.co", "a".repeat(72))).toEqual({});
  });

  it("reports both fields at once", () => {
    expect(Object.keys(validateAuth("signup", "bad", "x")).sort()).toEqual([
      "email",
      "password",
    ]);
  });
});
