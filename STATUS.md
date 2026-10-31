# Status

## Current phase

Phase 2A complete (GitHub URL parsing, repo resolution, tree fetch, filtering and caps). Next: Phase 2B.

## What works

- Live at https://ask-a-repo.onrender.com (Render free, auto-deploy from main). Phases 0 and 1 unchanged: /healthz, React shell, auth (signup, login, logout, /api/me), 18 auth tests.
- server/src/services/github.js:
  - parseRepoUrl: strict regex on the raw string; accepts only https://github.com/{owner}/{repo} with optional trailing slash or .git; rejects other hosts, http, userinfo, ports, extra paths, query, fragment, bad characters, ".", "..", ".git".
  - resolveRepo: default branch and latest commit SHA; EMPTY_REPO handled.
  - fetchTree: one recursive Git Trees call at the pinned SHA; TREE_TRUNCATED if GitHub truncates.
  - filterTree: allowlist js/jsx/ts/tsx/json/md; denies node_modules, dist, build, coverage, .git, vendor, lock files, _.min.js, _.map; uses tree sizes; skipped counts by reason.
  - Caps: MAX_FILES 150, MAX_FILE_BYTES 200 KB (skip, not error), MAX_TOTAL_BYTES 2 MB; REPO_TOO_LARGE with counts, NO_SUPPORTED_FILES when nothing is kept.
  - GithubError with codes INVALID_URL, REPO_NOT_FOUND, RATE_LIMITED (with reset time), TREE_TRUNCATED, REPO_TOO_LARGE, EMPTY_REPO, NO_SUPPORTED_FILES, UPSTREAM_ERROR. The token is never put in errors.
  - All calls use built-in fetch, a 10 s AbortController timeout and a Bearer GITHUB_TOKEN.
- server/scripts/list-repo.js <url> prints repo, branch, SHA, kept files and bytes, 10 largest files, skipped counts.
- GITHUB_TOKEN is required in config.js and listed in .env.example.
- Unit tests for parseRepoUrl (valid and hostile inputs) and filterTree (allowlist, denylist, lock and minified, size skip, caps).

## What is broken

- Nothing known. The GitHub calls have only been checked by running list-repo.js by hand; there are no mocked-fetch tests yet (2B).
- GITHUB_TOKEN must also be set in Render's environment, or the deploy crashes at boot.
- File contents are not fetched yet. No retries. How raw downloads count against GitHub rate limits is still to be verified.
- DECISIONS.md has no Phase 2 entries yet (URL regex vs new URL(), caps values, skip-vs-fail for large files).

## Files added or changed

- Added: server/src/services/github.js, server/scripts/list-repo.js, server/test/github.test.js
- Changed: server/src/config.js (GITHUB_TOKEN), .env.example, server/vitest.config.js (test GITHUB_TOKEN)

## Next

Phase 2B: fetch file contents at the pinned SHA, error hardening, mocked-fetch tests for resolveRepo, fetchTree and error mapping, then the Explain-back questions.
