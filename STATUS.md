# Status

## Current phase

Phase 2 complete (GitHub client: URL parsing, repo resolution, tree, filtering, caps, file contents, loadRepo). Next: Phase 3.

## What works

- Live at https://ask-a-repo.onrender.com (Render free, auto-deploy from main). Phases 0 and 1 unchanged: /healthz, React shell, auth (signup, login, logout, /api/me), 18 auth tests.
- server/src/services/github.js:
  - parseRepoUrl: strict regex on the raw string; accepts only https://github.com/{owner}/{repo} with optional trailing slash or .git; rejects other hosts, http, userinfo, ports, extra paths, query, fragment, bad characters, ".", "..", ".git".
  - resolveRepo: default branch and latest commit SHA; EMPTY_REPO handled.
  - fetchTree: one recursive Git Trees call at the pinned SHA; TREE_TRUNCATED if GitHub truncates.
  - filterTree: allowlist js/jsx/ts/tsx/json/md; denies node_modules, dist, build, coverage, .git, vendor, lock files, _.min.js, _.map; uses tree sizes; skipped counts by reason.
  - Caps: MAX_FILES 150, MAX_FILE_BYTES 200 KB (skip, not error), MAX_TOTAL_BYTES 2 MB; REPO_TOO_LARGE with counts, NO_SUPPORTED_FILES when nothing is kept.
  - fetchFileContents: Contents API (raw media type) at ref = commit SHA, concurrency 5, 10 s timeout, max 2 retries with jittered backoff on network errors and 5xx only; 404 and rate limits are not retried and stop the other workers. Skips and reports size mismatches (bytes vs tree size), invalid UTF-8 and NUL-containing files.
  - loadRepo(url): parse, resolve, tree, filter, contents; returns { owner, repo, branch, sha, files: [{ path, text }], skipped }; throws NO_SUPPORTED_FILES if every file is skipped.
  - getRateLimit(): lowest x-ratelimit-remaining seen (headers only).
  - GithubError codes: INVALID_URL, REPO_NOT_FOUND, RATE_LIMITED (with reset time), TREE_TRUNCATED, REPO_TOO_LARGE, EMPTY_REPO, NO_SUPPORTED_FILES, UPSTREAM_ERROR. The token is never put in errors.
- server/scripts/list-repo.js <url> [--fetch]: listing; with --fetch also files fetched, total lines, time, content skips and requests used.
- Tests: 94 passing (18 auth, 49 URL and filter, 27 mocked-fetch for resolveRepo, fetchTree, fetchFileContents, loadRepo). No real network in tests.

## What is broken

- Nothing known. GITHUB_TOKEN must be set in Render's environment, or the deploy crashes at boot.
- GitHub rate-limit accounting for downloads is an assumption (1 request per file against the REST limit). Verify with list-repo.js --fetch (the requests line) and correct the comment in github.js if it differs.
- A 404 on a single file reports "Repository not found, or it is private" (generic message).
- No ingestion route yet; nothing is stored.
- DECISIONS.md has no Phase 2 entries yet (URL regex vs new URL(), caps values, skip-vs-fail for large files, Contents API vs blobs vs raw host, retry policy).

## Files added or changed

- Added: server/src/services/github.js, server/scripts/list-repo.js, server/test/github.test.js, server/test/github.http.test.js
- Changed: server/src/config.js (GITHUB_TOKEN), .env.example, server/vitest.config.js (test GITHUB_TOKEN)

## Next

Phase 3: chunker, a pure function chunkFile({ path, text }, { windowLines, overlapLines }) with unit tests. Also add the Phase 2 DECISIONS.md entries.
