import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { filterTree, loadRepo, GithubError } from "../src/services/github.js";

const SHA = "a".repeat(40);
const blob = (path, size = 5) => ({ path, type: "blob", size, sha: "x" });
const TREE = [
  blob("src/a.js"),
  blob("test/a.test.js"),
  blob("src/b.spec.ts"),
  blob("tests/helper.js"),
  blob("src/latest.js"), // looks like "test" but is not a test file
];

describe("filterTree excludeTests", () => {
  it("off: keeps test files, counts none", () => {
    const { files, skipped } = filterTree(TREE);
    expect(files).toHaveLength(5);
    expect(skipped.test_file).toBe(0);
  });
  it("on: drops test and spec files and counts them as test_file", () => {
    const { files, skipped } = filterTree(TREE, { excludeTests: true });
    expect(files.map((f) => f.path)).toEqual(["src/a.js", "src/latest.js"]);
    expect(skipped.test_file).toBe(3);
  });
  it("on: a repo with only test files is NO_SUPPORTED_FILES", () => {
    try {
      filterTree([blob("test/a.test.js")], { excludeTests: true });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(GithubError);
      expect(err.code).toBe("NO_SUPPORTED_FILES");
    }
  });
});

describe("loadRepo excludeTests (fetch mocked)", () => {
  let fetchMock;
  beforeEach(() => {
    fetchMock = vi.fn(async (url) => {
      const u = String(url);
      const j = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
      if (u.endsWith("/repos/o/r"))
        return j({ default_branch: "main", name: "r", owner: { login: "o" } });
      if (u.includes("/commits?")) return j([{ sha: SHA }]);
      if (u.includes("/git/trees/")) return j({ truncated: false, tree: TREE });
      if (u.includes("/contents/")) return new Response("hello");
      return j({}, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());
  const contentCalls = () =>
    fetchMock.mock.calls.filter((c) => String(c[0]).includes("/contents/"))
      .length;

  it("on: test files are neither downloaded nor returned", async () => {
    const r = await loadRepo("https://github.com/o/r", {
      excludeTests: true,
      backoffMs: 1,
    });
    expect(r.files.map((f) => f.path)).toEqual(["src/a.js", "src/latest.js"]);
    expect(r.skipped.test_file).toBe(3);
    expect(contentCalls()).toBe(2);
  });
  it("off (default): everything is downloaded", async () => {
    const r = await loadRepo("https://github.com/o/r", { backoffMs: 1 });
    expect(r.files).toHaveLength(5);
    expect(r.skipped.test_file).toBe(0);
    expect(contentCalls()).toBe(5);
  });
});

describe("INDEX_EXCLUDE_TESTS config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });
  it.each([
    ["", true], // empty counts as unset, so the default applies
    ["true", true],
    ["false", false],
  ])("%j -> %s", async (value, expected) => {
    vi.resetModules();
    vi.stubEnv("INDEX_EXCLUDE_TESTS", value);
    const { config } = await import("../src/config.js");
    expect(config.INDEX_EXCLUDE_TESTS).toBe(expected);
  });
});
