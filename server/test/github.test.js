import { describe, it, expect } from "vitest";
import {
  parseRepoUrl,
  filterTree,
  GithubError,
  MAX_FILES,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
} from "../src/services/github.js";

function codeOf(fn) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(GithubError);
    return err.code;
  }
  return null;
}

describe("parseRepoUrl: valid", () => {
  it.each([
    ["https://github.com/facebook/react", "facebook", "react"],
    ["https://github.com/facebook/react/", "facebook", "react"],
    ["https://github.com/facebook/react.git", "facebook", "react"],
    ["https://github.com/facebook/react.git/", "facebook", "react"],
    ["https://github.com/Facebook/React", "Facebook", "React"],
    ["  https://github.com/a-b/c.d_e-f  ", "a-b", "c.d_e-f"],
    ["https://github.com/o/r.github", "o", "r.github"],
  ])("accepts %s", (input, owner, repo) => {
    expect(parseRepoUrl(input)).toEqual({ owner, repo });
  });
});

describe("parseRepoUrl: hostile or malformed", () => {
  it.each([
    ["http scheme", "http://github.com/o/r"],
    ["other host", "https://gitlab.com/o/r"],
    ["host suffix trick", "https://github.com.evil.com/o/r"],
    ["host prefix trick", "https://evilgithub.com/o/r"],
    ["subdomain", "https://api.github.com/o/r"],
    ["userinfo", "https://user:pw@github.com/o/r"],
    ["userinfo host swap", "https://github.com@evil.com/o/r"],
    ["explicit port", "https://github.com:443/o/r"],
    ["localhost", "https://localhost/o/r"],
    ["ip address", "https://127.0.0.1/o/r"],
    ["extra path segment", "https://github.com/o/r/tree/main"],
    ["double trailing slash", "https://github.com/o/r//"],
    ["query string", "https://github.com/o/r?x=1"],
    ["fragment", "https://github.com/o/r#readme"],
    ["dot-dot repo", "https://github.com/o/.."],
    ["dot repo", "https://github.com/o/."],
    ["dot-dot owner", "https://github.com/../r"],
    ["dot-git repo", "https://github.com/o/.git"],
    ["encoded traversal", "https://github.com/o/%2e%2e"],
    ["space in name", "https://github.com/o/my repo"],
    ["newline smuggling", "https://github.com/o/r\nhttps://evil.com"],
    ["unicode lookalike", "https://github.com/о/r"],
    ["owner starts with hyphen", "https://github.com/-o/r"],
    ["missing repo", "https://github.com/o"],
    ["empty string", ""],
    ["no scheme", "github.com/o/r"],
    ["overlong", "https://github.com/o/" + "a".repeat(300)],
  ])("rejects %s", (_name, input) => {
    expect(codeOf(() => parseRepoUrl(input))).toBe("INVALID_URL");
  });

  it.each([[undefined], [null], [42], [{}]])(
    "rejects non-string %s",
    (input) => {
      expect(codeOf(() => parseRepoUrl(input))).toBe("INVALID_URL");
    },
  );
});

const blob = (p, size = 100) => ({ path: p, type: "blob", size, sha: "x" });

describe("filterTree", () => {
  it("keeps allowlisted extensions and skips others", () => {
    const { files, skipped } = filterTree([
      blob("a.js"),
      blob("b.jsx"),
      blob("c.ts"),
      blob("d.tsx"),
      blob("e.json"),
      blob("README.md"),
      blob("img.png"),
      blob("Makefile"),
      blob("style.css"),
    ]);
    expect(files.map((f) => f.path)).toEqual([
      "a.js",
      "b.jsx",
      "c.ts",
      "d.tsx",
      "e.json",
      "README.md",
    ]);
    expect(skipped.unsupported_extension).toBe(3);
  });

  it("matches extensions case-insensitively", () => {
    expect(filterTree([blob("A.JS")]).files).toHaveLength(1);
  });

  it("skips denied directories at any depth", () => {
    const { files, skipped } = filterTree([
      blob("src/a.js"),
      blob("node_modules/x/i.js"),
      blob("client/dist/main.js"),
      blob("a/build/b.js"),
      blob("coverage/c.json"),
      blob(".git/config.json"),
      blob("vendor/v.js"),
    ]);
    expect(files.map((f) => f.path)).toEqual(["src/a.js"]);
    expect(skipped.denied_dir).toBe(6);
  });

  it("does not treat a file named like a denied dir as a denied dir", () => {
    expect(
      filterTree([blob("src/build.js"), blob("src/dist.md")]).files,
    ).toHaveLength(2);
  });

  it("skips lock files, minified files and source maps", () => {
    const { files, skipped } = filterTree([
      blob("src/a.js"),
      blob("package-lock.json"),
      blob("sub/package-lock.json"),
      blob("yarn.lock"),
      blob("pnpm-lock.yaml"),
      blob("lib/x.min.js"),
      blob("lib/x.js.map"),
    ]);
    expect(files.map((f) => f.path)).toEqual(["src/a.js"]);
    expect(skipped.lock_or_minified).toBe(6);
  });

  it("ignores non-blob entries without counting them", () => {
    const { files, skipped } = filterTree([
      { path: "src", type: "tree", sha: "t" },
      { path: "sub", type: "commit", sha: "c" },
      blob("src/a.js"),
    ]);
    expect(files).toHaveLength(1);
    expect(Object.values(skipped).every((n) => n === 0)).toBe(true);
  });

  it("skips (does not fail on) files over MAX_FILE_BYTES; exactly at the limit is kept", () => {
    const { files, skipped, totalBytes } = filterTree([
      blob("ok.js", MAX_FILE_BYTES),
      blob("big.js", MAX_FILE_BYTES + 1),
    ]);
    expect(files.map((f) => f.path)).toEqual(["ok.js"]);
    expect(skipped.too_large).toBe(1);
    expect(totalBytes).toBe(MAX_FILE_BYTES);
  });

  it("allows exactly MAX_FILES files", () => {
    const entries = Array.from({ length: MAX_FILES }, (_, i) =>
      blob(`f${i}.js`, 10),
    );
    expect(filterTree(entries).files).toHaveLength(MAX_FILES);
  });

  it("throws REPO_TOO_LARGE with counts above MAX_FILES", () => {
    const entries = Array.from({ length: MAX_FILES + 1 }, (_, i) =>
      blob(`f${i}.js`, 10),
    );
    try {
      filterTree(entries);
      expect.unreachable();
    } catch (err) {
      expect(err.code).toBe("REPO_TOO_LARGE");
      expect(err.details.fileCount).toBe(MAX_FILES + 1);
    }
  });

  it("throws REPO_TOO_LARGE above MAX_TOTAL_BYTES", () => {
    const each = 190 * 1024;
    const n = Math.ceil(MAX_TOTAL_BYTES / each) + 1;
    const entries = Array.from({ length: n }, (_, i) => blob(`f${i}.js`, each));
    expect(codeOf(() => filterTree(entries))).toBe("REPO_TOO_LARGE");
  });

  it("throws NO_SUPPORTED_FILES when nothing is kept", () => {
    expect(
      codeOf(() => filterTree([blob("a.png"), blob("node_modules/x.js")])),
    ).toBe("NO_SUPPORTED_FILES");
    expect(codeOf(() => filterTree([]))).toBe("NO_SUPPORTED_FILES");
  });
});
