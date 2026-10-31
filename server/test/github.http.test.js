import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  resolveRepo,
  fetchTree,
  fetchFileContents,
  loadRepo,
  GithubError,
} from "../src/services/github.js";

const SHA = "a".repeat(40);
const RESET = 1893456000; // 2030-01-01T00:00:00Z
const RESET_ISO = "2030-01-01T00:00:00.000Z";
const FAST = { backoffMs: 1 };

let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const raw = (data, status = 200) => new Response(data, { status });
const limited = () =>
  json({ message: "limit" }, 403, {
    "x-ratelimit-remaining": "0",
    "x-ratelimit-reset": String(RESET),
  });
const mk = (path, size) => ({ path, size, sha: "x" });

async function failure(promise) {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(GithubError);
    return err;
  }
  throw new Error("expected the promise to reject");
}

describe("resolveRepo", () => {
  it("returns branch and newest commit SHA, sending the bearer token", async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({ default_branch: "main", name: "Repo", owner: { login: "Own" } }),
      )
      .mockResolvedValueOnce(json([{ sha: SHA }]));
    expect(await resolveRepo({ owner: "own", repo: "repo" })).toEqual({
      owner: "Own",
      repo: "Repo",
      branch: "main",
      sha: SHA,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/own/repo");
    expect(init.headers.Authorization).toMatch(/^Bearer /);
    expect(fetchMock.mock.calls[1][0]).toContain("commits?sha=main&per_page=1");
  });

  it("maps 404 to REPO_NOT_FOUND", async () => {
    fetchMock.mockResolvedValueOnce(json({ message: "Not Found" }, 404));
    const err = await failure(resolveRepo({ owner: "o", repo: "r" }));
    expect(err.code).toBe("REPO_NOT_FOUND");
  });

  it("maps 403 with remaining 0 to RATE_LIMITED with the reset time", async () => {
    fetchMock.mockResolvedValueOnce(limited());
    const err = await failure(resolveRepo({ owner: "o", repo: "r" }));
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.details.resetAt).toBe(RESET_ISO);
    expect(err.message).toContain(RESET_ISO);
  });

  it("maps 429 with retry-after to RATE_LIMITED with a future reset time", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ message: "slow down" }, 429, { "retry-after": "60" }),
    );
    const err = await failure(resolveRepo({ owner: "o", repo: "r" }));
    expect(err.code).toBe("RATE_LIMITED");
    expect(Date.parse(err.details.resetAt)).toBeGreaterThan(Date.now());
  });

  it("maps 409 on the commits call to EMPTY_REPO", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ default_branch: "main" }))
      .mockResolvedValueOnce(
        json({ message: "Git Repository is empty." }, 409),
      );
    const err = await failure(resolveRepo({ owner: "o", repo: "r" }));
    expect(err.code).toBe("EMPTY_REPO");
  });

  it("maps an empty commit list to EMPTY_REPO", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ default_branch: "main" }))
      .mockResolvedValueOnce(json([]));
    const err = await failure(resolveRepo({ owner: "o", repo: "r" }));
    expect(err.code).toBe("EMPTY_REPO");
  });

  it("does not retry a 500 outside file downloads", async () => {
    fetchMock.mockImplementation(async () => json({}, 500));
    const err = await failure(resolveRepo({ owner: "o", repo: "r" }));
    expect(err.code).toBe("UPSTREAM_ERROR");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps a network error to UPSTREAM_ERROR without leaking the token", async () => {
    fetchMock.mockRejectedValueOnce(new Error("boom test-token-not-real"));
    const err = await failure(resolveRepo({ owner: "o", repo: "r" }));
    expect(err.code).toBe("UPSTREAM_ERROR");
    expect(err.message).not.toContain("test-token-not-real");
  });

  it("rejects a response with no default branch", async () => {
    fetchMock.mockResolvedValueOnce(json({ name: "r" }));
    const err = await failure(resolveRepo({ owner: "o", repo: "r" }));
    expect(err.code).toBe("UPSTREAM_ERROR");
  });
});

describe("fetchTree", () => {
  it("returns the entries from one recursive call at the pinned SHA", async () => {
    const tree = [{ path: "a.js", type: "blob", size: 1, sha: "x" }];
    fetchMock.mockResolvedValueOnce(json({ truncated: false, tree }));
    expect(await fetchTree("o", "r", SHA)).toEqual(tree);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      `https://api.github.com/repos/o/r/git/trees/${SHA}?recursive=1`,
    );
  });

  it("throws TREE_TRUNCATED when GitHub truncates the tree", async () => {
    fetchMock.mockResolvedValueOnce(json({ truncated: true, tree: [] }));
    const err = await failure(fetchTree("o", "r", SHA));
    expect(err.code).toBe("TREE_TRUNCATED");
  });

  it("rejects a response with no tree", async () => {
    fetchMock.mockResolvedValueOnce(json({ truncated: false }));
    const err = await failure(fetchTree("o", "r", SHA));
    expect(err.code).toBe("UPSTREAM_ERROR");
  });

  it("rejects a malformed SHA without calling GitHub", async () => {
    const err = await failure(fetchTree("o", "r", "../etc"));
    expect(err.code).toBe("UPSTREAM_ERROR");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("fetchFileContents", () => {
  it("downloads pinned to the SHA, encodes paths, keeps input order", async () => {
    fetchMock.mockImplementation(async (url) =>
      String(url).includes("a.md") ? raw("hi") : raw("abc"),
    );
    const files = [mk("src/b c.js", 3), mk("a.md", 2)];
    const r = await fetchFileContents("o", "r", SHA, files, FAST);
    expect(r.files).toEqual([
      { path: "src/b c.js", text: "abc" },
      { path: "a.md", text: "hi" },
    ]);
    const urls = fetchMock.mock.calls.map((c) => c[0]);
    expect(urls).toContain(
      `https://api.github.com/repos/o/r/contents/src/b%20c.js?ref=${SHA}`,
    );
    expect(fetchMock.mock.calls[0][1].headers.Accept).toBe(
      "application/vnd.github.raw+json",
    );
  });

  it("compares bytes, not characters (multibyte text is kept)", async () => {
    const text = "héllo ✓";
    fetchMock.mockImplementation(async () => raw(text));
    const r = await fetchFileContents(
      "o",
      "r",
      SHA,
      [mk("a.md", Buffer.byteLength(text))],
      FAST,
    );
    expect(r.files).toEqual([{ path: "a.md", text }]);
  });

  it("retries a 5xx and then succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(raw("x", 503))
      .mockResolvedValueOnce(raw("ok"));
    const r = await fetchFileContents("o", "r", SHA, [mk("a.js", 2)], FAST);
    expect(r.files).toEqual([{ path: "a.js", text: "ok" }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a network error and then succeeds", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(raw("ok"));
    const r = await fetchFileContents("o", "r", SHA, [mk("a.js", 2)], FAST);
    expect(r.files).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after 2 retries (3 calls) on a persistent 5xx", async () => {
    fetchMock.mockImplementation(async () => raw("x", 502));
    const err = await failure(
      fetchFileContents("o", "r", SHA, [mk("a.js", 1)], FAST),
    );
    expect(err.code).toBe("UPSTREAM_ERROR");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry a 404", async () => {
    fetchMock.mockImplementation(async () => json({ message: "nf" }, 404));
    const err = await failure(
      fetchFileContents("o", "r", SHA, [mk("a.js", 1)], FAST),
    );
    expect(err.code).toBe("REPO_NOT_FOUND");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a rate limit, reports the reset time, and stops other workers", async () => {
    fetchMock.mockImplementation(async () => limited());
    const files = Array.from({ length: 10 }, (_, i) => mk(`f${i}.js`, 1));
    const err = await failure(
      fetchFileContents("o", "r", SHA, files, { concurrency: 2, backoffMs: 1 }),
    );
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.details.resetAt).toBe(RESET_ISO);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("skips and reports a size mismatch", async () => {
    fetchMock.mockImplementation(async (url) =>
      String(url).includes("bad.js") ? raw("toolong") : raw("ok"),
    );
    const r = await fetchFileContents(
      "o",
      "r",
      SHA,
      [mk("ok.js", 2), mk("bad.js", 3)],
      FAST,
    );
    expect(r.files).toEqual([{ path: "ok.js", text: "ok" }]);
    expect(r.skipped).toEqual({ size_mismatch: 1, not_utf8: 0 });
    expect(r.skippedFiles).toEqual([
      { path: "bad.js", reason: "size_mismatch" },
    ]);
  });

  it("rejects invalid UTF-8 and NUL-containing files", async () => {
    fetchMock.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("bin.js")) return raw(new Uint8Array([0xff, 0xfe, 0x41]));
      if (u.includes("nul.js")) return raw(new Uint8Array([0x61, 0x00, 0x62]));
      return raw("x");
    });
    const r = await fetchFileContents(
      "o",
      "r",
      SHA,
      [mk("bin.js", 3), mk("nul.js", 3), mk("good.js", 1)],
      FAST,
    );
    expect(r.files).toEqual([{ path: "good.js", text: "x" }]);
    expect(r.skipped.not_utf8).toBe(2);
  });

  it("never runs more than 5 requests at once", async () => {
    let inFlight = 0;
    let peak = 0;
    fetchMock.mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return raw("x");
    });
    const files = Array.from({ length: 12 }, (_, i) => mk(`f${i}.js`, 1));
    const r = await fetchFileContents("o", "r", SHA, files, FAST);
    expect(r.files).toHaveLength(12);
    expect(peak).toBe(5);
  });

  it("rejects a malformed SHA without calling GitHub", async () => {
    const err = await failure(
      fetchFileContents("o", "r", "nothex", [mk("a.js", 1)]),
    );
    expect(err.code).toBe("UPSTREAM_ERROR");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("loadRepo", () => {
  const route = (contentFor) => async (url) => {
    const u = String(url);
    if (u.endsWith("/repos/o/r"))
      return json({ default_branch: "main", name: "r", owner: { login: "o" } });
    if (u.includes("/commits?")) return json([{ sha: SHA }]);
    if (u.includes("/git/trees/"))
      return json({
        truncated: false,
        tree: [
          { path: "a.js", type: "blob", size: 5, sha: "x" },
          { path: "img.png", type: "blob", size: 9, sha: "y" },
        ],
      });
    if (u.includes("/contents/a.js")) return raw(contentFor);
    return json({}, 404);
  };

  it("runs parse, resolve, tree, filter and contents", async () => {
    fetchMock.mockImplementation(route("hello"));
    const r = await loadRepo("https://github.com/o/r", FAST);
    expect(r).toMatchObject({
      owner: "o",
      repo: "r",
      branch: "main",
      sha: SHA,
      files: [{ path: "a.js", text: "hello" }],
      skipped: { unsupported_extension: 1, size_mismatch: 0, not_utf8: 0 },
    });
  });

  it("rejects a bad URL without calling GitHub", async () => {
    const err = await failure(loadRepo("https://evil.com/o/r"));
    expect(err.code).toBe("INVALID_URL");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws NO_SUPPORTED_FILES when every file is skipped", async () => {
    fetchMock.mockImplementation(route("toolong"));
    const err = await failure(loadRepo("https://github.com/o/r", FAST));
    expect(err.code).toBe("NO_SUPPORTED_FILES");
  });
});
