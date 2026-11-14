import { describe, it, expect } from "vitest";
import {
  orderSources,
  isGithubUrl,
  formatAskError,
} from "../../client/src/chatHelpers.js";

describe("orderSources", () => {
  it("cited first, then by number, without mutating", () => {
    const input = [
      { n: 1, cited: false },
      { n: 2, cited: true },
      { n: 3, cited: false },
      { n: 4, cited: true },
    ];
    expect(orderSources(input).map((s) => s.n)).toEqual([2, 4, 1, 3]);
    expect(input.map((s) => s.n)).toEqual([1, 2, 3, 4]);
  });
  it("handles bad input", () => {
    expect(orderSources(undefined)).toEqual([]);
  });
});

describe("isGithubUrl", () => {
  it.each([
    ["https://github.com/o/r/blob/abc/a.js#L1-L2", true],
    ["http://github.com/o/r", false],
    ["https://github.com.evil.com/o/r", false],
    ["https://evilgithub.com/o/r", false],
    ["https://github.com", false],
    ["javascript:alert(1)", false],
    ["data:text/html,x", false],
    ["", false],
    [undefined, false],
    [{}, false],
  ])("%j -> %s", (u, ok) => expect(isGithubUrl(u)).toBe(ok));
});

describe("formatAskError", () => {
  it.each([
    ["VALIDATION_ERROR", /1 to 500/],
    ["QUOTA_EXHAUSTED", /midnight UTC/],
    ["EMBEDDING_RATE_LIMITED", /minute/],
    ["LLM_RATE_LIMITED", /minute/],
    ["UPSTREAM_TIMEOUT", /too long/],
    ["ANSWER_FAILED", /try again/i],
    ["REPO_NOT_READY", /not ready/],
    ["STREAM_INTERRUPTED", /interrupted/],
    ["ANSWER_TOO_LONG", /narrower/],
  ])("maps %s", (code, re) =>
    expect(formatAskError({ code, message: "raw" })).toMatch(re),
  );
  it("falls back to the error message, then generic", () => {
    expect(formatAskError({ code: "NETWORK", message: "Cannot reach." })).toBe(
      "Cannot reach.",
    );
    expect(formatAskError(undefined)).toMatch(/Something went wrong/);
  });
  it("ignores Object.prototype keys", () => {
    expect(formatAskError({ code: "toString", message: "m" })).toBe("m");
  });
});
