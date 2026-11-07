import path from "node:path";
import { config } from "../config.js";
import { isTestPath } from "./testPaths.js";

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Lowest x-ratelimit-remaining seen (it only falls within a window). Headers only, never the token.
// list-repo.js uses it to measure how many requests a run cost.
let rateLimit = { limit: null, remaining: null, reset: null };
export function getRateLimit() {
  return { ...rateLimit };
}
function trackRateLimit(res) {
  const header = res.headers.get("x-ratelimit-remaining");
  if (header === null) return;
  const remaining = Number(header);
  if (Number.isNaN(remaining)) return;
  if (rateLimit.remaining === null || remaining < rateLimit.remaining) {
    rateLimit = {
      limit: Number(res.headers.get("x-ratelimit-limit")) || null,
      remaining,
      reset: Number(res.headers.get("x-ratelimit-reset")) || null,
    };
  }
}

// One attempt. err.details.retryable is true for network errors, timeouts and 5xx only.
async function githubRequest(
  apiPath,
  { accept = "application/vnd.github+json", bytes = false } = {},
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(API_BASE + apiPath, {
      headers: {
        Authorization: `Bearer ${config.GITHUB_TOKEN}`,
        Accept: accept,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "ask-a-repo",
      },
      signal: controller.signal,
    });
    trackRateLimit(res);
    if (!res.ok) {
      const err = mapError(res);
      err.details.retryable = res.status >= 500;
      throw err;
    }
    return bytes ? new Uint8Array(await res.arrayBuffer()) : await res.json();
  } catch (err) {
    if (err instanceof GithubError) throw err;
    // Network error, timeout or bad body. Never include err or headers: keep the token out.
    throw new GithubError(
      "UPSTREAM_ERROR",
      "Could not get a valid response from GitHub",
      { retryable: true },
    );
  } finally {
    clearTimeout(timer);
  }
}

// Retries only when asked (retries > 0) and only for retryable errors.
// 404, rate limits and other 4xx are never retried. Backoff: base * 2^attempt, with jitter.
async function githubGet(apiPath, opts = {}) {
  const { retries = 0, backoffMs = 300, ...req } = opts;
  for (let attempt = 0; ; attempt++) {
    try {
      return await githubRequest(apiPath, req);
    } catch (err) {
      const retryable = err instanceof GithubError && err.details.retryable;
      if (!retryable || attempt >= retries) throw err;
      await sleep(backoffMs * 2 ** attempt * (0.5 + Math.random()));
    }
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
export function filterTree(entries, { excludeTests = false } = {}) {
  const skipped = {
    denied_dir: 0,
    lock_or_minified: 0,
    unsupported_extension: 0,
    test_file: 0,
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
    } else if (excludeTests && isTestPath(e.path)) {
      skipped.test_file++;
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

// ---- File contents ----
const SHA_RE = /^[0-9a-f]{40}$/;
const RAW_ACCEPT = "application/vnd.github.raw+json";
const utf8 = new TextDecoder("utf-8", { fatal: true });

// RATE LIMITS: each file is one authenticated REST call to api.github.com (Contents API, raw
// media type, ref = commit SHA). It is NOT raw.githubusercontent.com. I believe it counts
// against the token's primary REST limit (documented as 5,000 requests/hour for a user token),
// so one ingest costs at most MAX_FILES + 3 = 153 requests.
// UNSURE, verify in GitHub's docs: (1) the exact hourly limit for a fine-grained PAT,
// (2) that raw-media-type responses count like normal ones, (3) secondary limits (concurrent
// requests and per-minute caps). 5 concurrent requests should be far inside them.
// Measure it: `list-repo.js <url> --fetch` prints requests used (from x-ratelimit-remaining).
// Expect used == number of files fetched. GET /rate_limit shows your quota without costing any.
export async function fetchFileContents(
  owner,
  repo,
  sha,
  files,
  { concurrency = 5, retries = 2, backoffMs = 300 } = {},
) {
  if (!SHA_RE.test(sha)) {
    throw new GithubError("UPSTREAM_ERROR", "Invalid commit SHA");
  }
  const results = new Array(files.length);
  const skippedFiles = [];
  let next = 0;
  let stop = false; // set on a fatal error so the other workers stop making requests

  async function worker() {
    while (!stop) {
      const i = next++;
      if (i >= files.length) return;
      const f = files[i];
      try {
        const apiPath = `/repos/${enc(owner)}/${enc(repo)}/contents/${f.path
          .split("/")
          .map(enc)
          .join("/")}?ref=${sha}`;
        const bytes = await githubGet(apiPath, {
          accept: RAW_ACCEPT,
          bytes: true,
          retries,
          backoffMs,
        });
        // The tree size is the blob's byte size, so compare bytes, not characters.
        if (bytes.byteLength !== f.size) {
          skippedFiles.push({ path: f.path, reason: "size_mismatch" });
          continue;
        }
        // A NUL byte is valid UTF-8 but means binary, so treat it as not text.
        let text;
        try {
          if (bytes.includes(0)) throw new Error("NUL byte");
          text = utf8.decode(bytes);
        } catch {
          skippedFiles.push({ path: f.path, reason: "not_utf8" });
          continue;
        }
        results[i] = { path: f.path, text };
      } catch (err) {
        stop = true;
        throw err;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, files.length) }, worker),
  );

  skippedFiles.sort((a, b) => a.path.localeCompare(b.path));
  const skipped = { size_mismatch: 0, not_utf8: 0 };
  for (const s of skippedFiles) skipped[s.reason]++;
  return { files: results.filter(Boolean), skipped, skippedFiles };
}

// ---- Everything: URL -> files with text ----
export async function loadRepo(url, opts = {}) {
  const { excludeTests = false, ...fetchOpts } = opts;
  const parsed = parseRepoUrl(url);
  const { owner, repo, branch, sha } = await resolveRepo(parsed);
  const entries = await fetchTree(owner, repo, sha);
  const tree = filterTree(entries, { excludeTests });
  const content = await fetchFileContents(
    owner,
    repo,
    sha,
    tree.files,
    fetchOpts,
  );
  if (content.files.length === 0) {
    throw new GithubError(
      "NO_SUPPORTED_FILES",
      "No readable text files found (all were skipped)",
      { skipped: { ...tree.skipped, ...content.skipped } },
    );
  }
  return {
    owner,
    repo,
    branch,
    sha,
    files: content.files,
    skipped: { ...tree.skipped, ...content.skipped },
  };
}
