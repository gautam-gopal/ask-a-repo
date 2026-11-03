import { describe, it, expect } from "vitest";
import {
  statusLabel,
  isActive,
  progressPercent,
  formatError,
  formatCreated,
} from "../../client/src/repoHelpers.js";

describe("statusLabel / isActive", () => {
  it.each([
    ["queued", "Queued"],
    ["indexing", "Indexing"],
    ["ready", "Ready"],
    ["failed", "Failed"],
    ["weird", "Unknown"],
    [undefined, "Unknown"],
  ])("%s -> %s", (s, label) => expect(statusLabel(s)).toBe(label));

  it("only queued and indexing are active", () => {
    expect(["queued", "indexing"].every(isActive)).toBe(true);
    expect(["ready", "failed", undefined].some(isActive)).toBe(false);
  });
});

describe("progressPercent", () => {
  it.each([
    [{ embedded: 0, total: 0 }, 0],
    [{ embedded: 32, total: 70 }, 45],
    [{ embedded: 69, total: 70 }, 98],
    [{ embedded: 70, total: 70 }, 100],
    [{ embedded: 90, total: 70 }, 100],
    [{ embedded: -5, total: 70 }, 0],
    [{ embedded: "x", total: 70 }, 0],
    [{}, 0],
    [undefined, 0],
    [null, 0],
  ])("%j -> %i", (p, pct) => expect(progressPercent(p)).toBe(pct));
});

describe("formatError", () => {
  it.each([
    ["INVALID_URL", /github\.com\/owner\/name/],
    ["VALIDATION_ERROR", /URL/],
    ["REPO_EXISTS", /already/],
    ["INGEST_IN_PROGRESS", /still being indexed/],
    ["REPO_LIMIT_REACHED", /at most 3/],
    ["BUSY", /about a minute/],
  ])("maps %s", (code, re) => {
    expect(formatError({ code, message: "raw server text" })).toMatch(re);
  });

  it("falls back to the error's own message for other codes", () => {
    expect(
      formatError({ code: "NETWORK", message: "Cannot reach the server." }),
    ).toBe("Cannot reach the server.");
  });

  it("falls back to a generic message", () => {
    expect(formatError({ code: "X" })).toMatch(/Something went wrong/);
    expect(formatError(undefined)).toMatch(/Something went wrong/);
  });

  it("does not treat Object.prototype keys as codes", () => {
    expect(formatError({ code: "toString", message: "m" })).toBe("m");
  });
});

describe("formatCreated", () => {
  it("formats a valid date and rejects bad input", () => {
    expect(formatCreated("2026-01-01T00:00:00Z")).not.toBe("");
    expect(formatCreated("garbage")).toBe("");
    expect(formatCreated(null)).toBe("");
    expect(formatCreated(undefined)).toBe("");
  });
});
