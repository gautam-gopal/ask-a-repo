import { describe, it, expect } from "vitest";
import {
  EXAMPLE_QUESTIONS,
  middleTruncate,
  summarizeSources,
  githubRepoUrl,
  githubCommitUrl,
  formatTime,
} from "../../client/src/chatHelpers.js";

describe("middleTruncate", () => {
  it("leaves short text unchanged", () => {
    expect(middleTruncate("src/a.js", 40)).toBe("src/a.js");
  });
  it("is exactly max long, keeps the start and the file name", () => {
    const p = "frontend/src/components/chat/GroupMembersModal.jsx";
    const out = middleTruncate(p, 30);
    expect(out).toHaveLength(30);
    expect(out).toContain("…");
    expect(out.startsWith("frontend/")).toBe(true);
    expect(out.endsWith("Modal.jsx")).toBe(true);
  });
  it("handles bad input and tiny limits", () => {
    expect(middleTruncate(undefined)).toBe("");
    expect(middleTruncate(5)).toBe("");
    expect(middleTruncate("abcdefgh", 1)).toHaveLength(3);
  });
});

describe("summarizeSources", () => {
  it("orders cited first and counts", () => {
    const r = summarizeSources([
      { n: 1, cited: false },
      { n: 2, cited: true },
      { n: 3, cited: true },
      { n: 4, cited: false },
    ]);
    expect(r.list.map((s) => s.n)).toEqual([2, 3, 1, 4]);
    expect([r.total, r.cited]).toEqual([4, 2]);
    expect(r.label).toBe("4 sources, 2 cited");
  });
  it("singular, empty and bad input", () => {
    expect(summarizeSources([{ n: 1, cited: true }]).label).toBe(
      "1 source, 1 cited",
    );
    expect(summarizeSources([]).label).toBe("No sources");
    expect(summarizeSources(undefined)).toMatchObject({ total: 0, cited: 0 });
  });
});

describe("GitHub link builders", () => {
  const sha = "a".repeat(40);
  it("builds repo and commit URLs from valid parts", () => {
    const repo = { owner: "octo", name: "hello.js", commitSha: sha };
    expect(githubRepoUrl(repo)).toBe("https://github.com/octo/hello.js");
    expect(githubCommitUrl(repo)).toBe(
      `https://github.com/octo/hello.js/commit/${sha}`,
    );
  });
  it.each([
    [{ owner: "a/b", name: "r" }],
    [{ owner: "o", name: ".." }],
    [{ owner: "o", name: "x y" }],
    [{ owner: "-ok", name: "r?x=1" }],
    [{ owner: 1, name: "r" }],
    [undefined],
  ])("rejects %j", (repo) => {
    expect(githubRepoUrl(repo)).toBeNull();
    expect(githubCommitUrl(repo)).toBeNull();
  });
  it("commit URL needs a full 40-hex sha", () => {
    expect(
      githubCommitUrl({ owner: "o", name: "r", commitSha: "abc1234" }),
    ).toBeNull();
    expect(githubCommitUrl({ owner: "o", name: "r" })).toBeNull();
  });
});

describe("formatTime and examples", () => {
  it("formats a valid date and rejects bad input", () => {
    expect(formatTime("2026-01-01T10:00:00Z")).not.toBe("");
    for (const v of ["garbage", null, undefined, ""])
      expect(formatTime(v)).toBe("");
  });
  it("has three usable example questions", () => {
    expect(EXAMPLE_QUESTIONS).toHaveLength(3);
    for (const q of EXAMPLE_QUESTIONS) {
      expect(q.trim()).not.toBe("");
      expect(q.length).toBeLessThanOrEqual(500);
    }
  });
});
