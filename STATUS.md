# Status

## Current phase

Phase 5 complete (5A ingest pipeline, 5B HTTP routes). Next: Phase 6 — Retrieval.

## What works

- Live at https://ask-a-repo.onrender.com (Render free, auto-deploy from main). Phases 0 to 4: /healthz, React shell, auth, GitHub client, chunker (defaults 50 / 10 / 1500), embeddings service (Cloudflare Workers AI, 768 dims), Chunk model, Atlas vector index `chunks_vector`.
- Phase 5A: Repo model (7-day TTL, demo exempt), `services/ingest.js` (startIngest, runIngest, recoverInterruptedIngests, IngestError), `scripts/ingest-run.js`. Limits: MAX_REPOS_PER_USER 3, one active ingest per user, MAX_CONCURRENT_INGESTS 2, 10 minute limit. Failure deletes chunks and stores a fixed safe error. Boot recovery marks queued/indexing repos failed (INTERRUPTED).
- Phase 5B: `server/src/routes/repos.js`, mounted at /api/repos above the SPA fallback, all behind requireAuth:
  - `POST /` { url } -> 202 `{ repo }`. IngestError mapping: INVALID_URL 400; REPO_EXISTS, INGEST_IN_PROGRESS, REPO_LIMIT_REACHED 409; BUSY 503 with Retry-After 60. GithubError safety-net mapping (404, 503, 400, 502).
  - `GET /` -> `{ repos }`, newest first. `GET /:id` -> `{ repo }` with progress and error, for polling.
  - `DELETE /:id` -> `{ ok: true }`; deletes the repo, then its chunks. Queued or indexing returns 409 INGEST_IN_PROGRESS.
  - Other users' repos and missing repos both return 404 REPO_NOT_FOUND. Malformed id returns 400 INVALID_ID.
  - Public shape is an allowlist: id, owner, name, status, progress, error, fileCount, chunkCount, branch, commitSha, createdAt.
- Fixed a duplicate `User` import in index.js.
- Tests: all passing, no network. New: repos.routes.test.js (fake Repo and Chunk, mocked startIngest). fakeIngestModels.js gained `.sort()`.
- `DECISIONS.md` has D-001 to D-033.

## What is broken

- Nothing known.
- No rate limiting yet (Phase 12): POST /api/repos and auth routes can be hammered. Do not share the link widely.
- No client UI for repos yet (Phase 8). No cancel button for an indexing repo (D-033).
- GitHub failures (not found, private, rate limit) appear as a failed repo via polling, not as a POST error (D-032).
- The 10 minute ingest limit is checked between stages and batches only, and has no test.
- Recovery assumes a single instance (D-027). Concurrency and one-active-per-user live in process memory, so they break with more than one instance.
- The fakes do not prove the real unique index, the TTL index or Mongoose behaviour; the ingest-run.js and live curl checks cover that.
- Still unmeasured or unconfirmed: embedding batch limit (32 assumed safe), Cloudflare reset time (assumed 00:00 UTC), whether the vector index counts toward 512 MB, truncation at 512 tokens, GitHub download rate-limit accounting, score threshold, chunking defaults (Phase 10).
- Updating isDemo on an existing repo must also $unset expiresAt (the hook only runs on create and save).

## Files added or changed (5B)

- Added: `server/src/routes/repos.js`, `server/test/repos.routes.test.js`
- Changed: `server/src/index.js` (router mount, duplicate import fixed), `server/test/app.js`, `server/test/fakeIngestModels.js`, `server/src/services/ingest.js` (comment only), `DECISIONS.md` (D-031 to D-033), `STATUS.md`

## Next

**Phase 6:** `services/retrieve.js` (embed query, `$vectorSearch` filtered by repoId inside the query, numCandidates 10 to 20 times the limit, dedupe overlapping chunks, top 5), an owner-checked retrieval route or script, a test that user B cannot query user A's repo, and a script that prints top chunks and scores for 10 known questions.
