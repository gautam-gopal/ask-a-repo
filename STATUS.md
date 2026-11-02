# Status

## Current phase

Phase 5A complete (Repo model, ingest service, boot recovery, CLI run). Next: Phase 5B — HTTP routes and limits.

## What works

- Live at https://ask-a-repo.onrender.com (Render free, auto-deploy from main). Phases 0 to 4 unchanged: /healthz, React shell, auth, GitHub client, chunker (defaults 50 / 10 / 1500), embeddings service (Cloudflare Workers AI, 768 dims), Chunk model, Atlas vector index `chunks_vector`.
- `server/src/models/Repo.js`: userId, owner/name (display) and ownerLower/nameLower, branch, commitSha, status (queued | indexing | ready | failed), error { code, message }, fileCount, chunkCount, progress { embedded, total }, usage { estimatedTokens, estimatedNeurons }, isDemo, timestamps, expiresAt. Unique index { userId, ownerLower, nameLower }; TTL on expiresAt. A pre-validate hook sets expiresAt to now + REPO_TTL_MS (7 days), and removes it for demo repos.
- `server/src/services/ingest.js`:
  - `startIngest({ userId, url })`: parses the URL, reserves a slot synchronously, enforces limits (MAX_REPOS_PER_USER 3, one active ingest per user, MAX_CONCURRENT_INGESTS 2), replaces a failed repo for the same URL, throws REPO_EXISTS for any other existing one, creates the repo as queued, starts `runIngest` unawaited, and returns the doc.
  - `runIngest(repoId)`: indexing, loadRepo, chunk, then per batch of 32 embed, insertMany (ordered: false, throwOnValidationError), update progress. Finally a stored-vs-chunked count check and ready with chunkCount, fileCount, branch, commitSha, GitHub's owner/name casing. 10 minute limit. Never throws; always releases the slot.
  - Failure: chunks deleted, status failed with a fixed safe { code, message } (GithubError and EmbeddingError tables, QUOTA_EXHAUSTED mentions midnight UTC, unknown errors become INTERNAL). If the repo is deleted mid-ingest the job cleans up and stops.
  - `recoverInterruptedIngests()`: called in index.js after Mongo connects and indexes are built, before listening. Marks queued and indexing repos failed (INTERRUPTED) and deletes their chunks.
  - `IngestError` codes: INVALID_URL (400), REPO_LIMIT_REACHED (403), INGEST_IN_PROGRESS (409), REPO_EXISTS (409), BUSY (503). Planned HTTP mapping is in a comment in ingest.js.
- `embeddings.js` gained the pure `estimateUsage(texts)` (per-ingest estimate; `getUsage()` stays process-wide).
- `server/scripts/ingest-run.js <url> [--yes] [--keep]`: prints the estimate first, runs only with --yes, polls every 2 s, prints the final doc, chunk count, time and neurons, then cleans up unless --keep.
- Tests: all passing, no network. New: ingest.test.js (fake Repo and Chunk models in test/fakeIngestModels.js, mocked loadRepo and embedDocuments, real chunker), repo.model.test.js.
- `DECISIONS.md` has D-001 to D-030.

## What is broken

- Nothing known.
- No routes, no rate limiting, no client changes yet (5B and later).
- The 10 minute ingest limit is checked between stages and batches only, and has no test.
- Recovery assumes a single instance. During a Render deploy overlap the new instance could fail a job the old one is still running (D-027). Jobs are never resumed.
- Concurrency and one-active-per-user live in process memory, so they break with more than one instance.
- The fakes do not prove the real unique index, the TTL index, or Mongoose insertMany behaviour. The ingest-run.js check against Atlas covers that.
- Still unmeasured or unconfirmed: embedding batch limit (32 assumed safe), Cloudflare reset time (assumed 00:00 UTC), whether the vector index counts toward 512 MB, truncation at 512 tokens, GitHub download rate-limit accounting, score threshold, chunking defaults (all Phase 10).
- Updating isDemo on an existing repo must also $unset expiresAt (the hook only runs on create and save).

## Files added or changed

- Added: `server/src/models/Repo.js`, `server/src/services/ingest.js`, `server/scripts/ingest-run.js`, `server/test/fakeIngestModels.js`, `server/test/ingest.test.js`, `server/test/repo.model.test.js`
- Changed: `server/src/services/embeddings.js` (estimateUsage), `server/src/index.js` (Repo.init, Chunk.init, boot recovery), `DECISIONS.md` (D-025 to D-030), `STATUS.md`

## Next

**Phase 5B:** `POST /api/repos` (202, zod, IngestError to HTTP mapping), `GET /api/repos`, `GET /api/repos/:id` (owner-checked, for polling), `DELETE /api/repos/:id` (repo and chunks), route tests, live curl checks on Render, then the Phase 5 Explain-back.
