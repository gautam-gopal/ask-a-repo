import path from "node:path";
import { config } from "../config.js";

// ---- Caps (single place) ----
export const MAX_FILES = 150;
export const MAX_FILE_BYTES = 200 * 1024;
export const MAX_TOTAL_BYTES = 2 * 1024 * 1024;

const API_BASE = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 10_000;

const ALLOWED_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".json",
  ".md",
]);
const DENIED_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".git",
  "vendor",
]);
const DENIED_NAMES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
]);

// Codes: INVALID_URL, REPO_NOT_FOUND, RATE_LIMITED, TREE_TRUNCATED,
// REPO_TOO_LARGE, EMPTY_REPO, NO_SUPPORTED_FILES, UPSTREAM_ERROR
export class GithubError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "GithubError";
    this.code = code;
    this.details = details;
  }
}

// ---- URL parsing (security control: we only ever call api.github.com) ----
// Matched against the raw string, not new URL(), because URL() silently
// normalises things we want rejected (default port :443, userinfo, "..").
const OWNER = "[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})"; // GitHub username rules
const REPO = "[A-Za-z0-9._-]{1,100}"; // no "/" , "%", "?", "#", "@", ":", spaces
const URL_RE = new RegExp(
  `^https://github\\.com/(${OWNER})/(${REPO}?)(?:\\.git)?/?$`,
);

export function parseRepoUrl(input) {
  const bad = (why) =>
    new GithubError("INVALID_URL", `Invalid repository URL: ${why}`);
  if (typeof input !== "string") throw bad("must be a string");
  const text = input.trim();
  if (text.length > 200) throw bad("too long");
  // Why each rejection exists (all enforced by URL_RE):
  // - non-https scheme: no plaintext, no file:/ftp: tricks
  // - host other than exactly github.com: the SSRF guard (blocks github.com.evil.com, localhost, IPs)
  // - "@" userinfo and ":" port: would change the effective host (github.com@evil.com)
  // - extra path segments: only the repo root is a valid input
  // - "?" and "#": no smuggled parameters
  // - characters outside [A-Za-z0-9._-]: no "%2e%2e", slashes, whitespace, unicode lookalikes
  const m = URL_RE.exec(text);
  if (!m) throw bad("expected https://github.com/{owner}/{repo}");
  const [, owner, repo] = m;
  // "." / ".." are path traversal; ".git" is not a real repo name
  if (repo === "." || repo === ".." || repo === ".git")
    throw bad("invalid repository name");
  return { owner, repo };
}

// ---- HTTP ----
function mapError(res) {
  const status = res.status;
  const remaining = res.headers.get("x-ratelimit-remaining");
  const retryAfter = Number(res.headers.get("retry-after"));
  if (
    status === 429 ||
    (status === 403 && (remaining === "0" || retryAfter > 0))
  ) {
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    let resetAt = null;
    if (reset > 0) resetAt = new Date(reset * 1000).toISOString();
    else if (retryAfter > 0)
      resetAt = new Date(Date.now() + retryAfter * 1000).toISOString();
    return new GithubError(
      "RATE_LIMITED",
      `GitHub rate limit reached${resetAt ? `; resets at ${resetAt}` : ""}`,
      { resetAt },
    );
  }
  // GitHub returns 404 (not 403) for private repos to an unauthenticated or
  // unauthorised caller, so "private" and "does not exist" cannot be told apart.
  if (status === 404)
    return new GithubError(
      "REPO_NOT_FOUND",
      "Repository not found, or it is private",
    );
  if (status === 409)
    return new GithubError("EMPTY_REPO", "Repository is empty");
  if (status === 401)
    return new GithubError(
      "UPSTREAM_ERROR",
      "GitHub rejected the server credentials",
    );
  return new GithubError("UPSTREAM_ERROR", `GitHub returned status ${status}`);
}

async function githubGet(apiPath) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(API_BASE + apiPath, {
      headers: {
        Authorization: `Bearer ${config.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "ask-a-repo",
      },
      signal: controller.signal,
    });
    if (!res.ok) throw mapError(res);
    return await res.json();
  } catch (err) {
    if (err instanceof GithubError) throw err;
    // Network error, timeout or bad JSON. Never include err or headers: keep the token out.
    throw new GithubError(
      "UPSTREAM_ERROR",
      "Could not get a valid response from GitHub",
    );
  } finally {
    clearTimeout(timer);
  }
}

const enc = encodeURIComponent;

// ---- Resolve default branch + latest commit SHA ----
export async function resolveRepo({ owner, repo }) {
  const info = await githubGet(`/repos/${enc(owner)}/${enc(repo)}`);
  if (typeof info?.default_branch !== "string" || !info.default_branch) {
    throw new GithubError(
      "UPSTREAM_ERROR",
      "GitHub response had no default branch",
    );
  }
  const branch = info.default_branch;
  // An empty repo returns 409 here (mapped to EMPTY_REPO); [] is handled too.
  const commits = await githubGet(
    `/repos/${enc(owner)}/${enc(repo)}/commits?sha=${enc(branch)}&per_page=1`,
  );
  const sha = Array.isArray(commits) ? commits[0]?.sha : undefined;
  if (typeof sha !== "string")
    throw new GithubError("EMPTY_REPO", "Repository has no commits");
  return {
    owner: info.owner?.login ?? owner,
    repo: info.name ?? repo,
    branch,
    sha,
  };
}

// ---- Full recursive tree at a pinned SHA (one API call) ----
export async function fetchTree(owner, repo, sha) {
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new GithubError("UPSTREAM_ERROR", "Invalid commit SHA");
  }
  const data = await githubGet(
    `/repos/${enc(owner)}/${enc(repo)}/git/trees/${sha}?recursive=1`,
  );
  if (!Array.isArray(data?.tree)) {
    throw new GithubError("UPSTREAM_ERROR", "GitHub response had no file tree");
  }
  if (data.truncated) {
    throw new GithubError(
      "TREE_TRUNCATED",
      "Repository is too large: GitHub truncated the file tree",
    );
  }
  return data.tree;
}

// ---- Filtering + caps (pure; uses sizes already in the tree entries) ----
export function filterTree(entries) {
  const skipped = {
    denied_dir: 0,
    lock_or_minified: 0,
    unsupported_extension: 0,
    too_large: 0,
  };
  const files = [];
  let totalBytes = 0;

  for (const e of entries) {
    if (e.type !== "blob") continue; // directories and submodules are not files
    const parts = e.path.split("/");
    const name = parts[parts.length - 1];
    const size = e.size ?? 0;

    if (parts.slice(0, -1).some((d) => DENIED_DIRS.has(d))) {
      skipped.denied_dir++;
    } else if (
      DENIED_NAMES.has(name) ||
      name.endsWith(".min.js") ||
      name.endsWith(".map")
    ) {
      skipped.lock_or_minified++;
    } else if (
      !ALLOWED_EXTENSIONS.has(path.posix.extname(name).toLowerCase())
    ) {
      skipped.unsupported_extension++;
    } else if (size > MAX_FILE_BYTES) {
      skipped.too_large++;
    } else {
      files.push({ path: e.path, size, sha: e.sha });
      totalBytes += size;
    }
  }

  if (files.length > MAX_FILES || totalBytes > MAX_TOTAL_BYTES) {
    throw new GithubError(
      "REPO_TOO_LARGE",
      `Repository too large: ${files.length} files / ${totalBytes} bytes (limits ${MAX_FILES} files / ${MAX_TOTAL_BYTES} bytes)`,
      {
        fileCount: files.length,
        totalBytes,
        maxFiles: MAX_FILES,
        maxTotalBytes: MAX_TOTAL_BYTES,
      },
    );
  }
  if (files.length === 0) {
    throw new GithubError(
      "NO_SUPPORTED_FILES",
      "No supported files found (js, jsx, ts, tsx, json, md)",
      { skipped },
    );
  }
  return { files, totalBytes, skipped };
}
