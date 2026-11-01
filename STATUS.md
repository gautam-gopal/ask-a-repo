# Status

## Current phase

Phase 4 complete (4A embeddings service, 4B Chunk model and Atlas vector index). Next: Phase 5 — ingest pipeline.

## What works

- Live at https://ask-a-repo.onrender.com (Render free, auto-deploy from main). Phases 0 to 3 unchanged: /healthz, React shell, auth, GitHub client, chunker (defaults 50 / 10 / 1500).
- `server/src/services/embeddings.js` (Cloudflare Workers AI, `@cf/baai/bge-base-en-v1.5`, 768 dims, cls pooling; the only file that knows the provider):
  - `embedDocuments(texts, options?)`: batches of 32, concurrency 2, 20 s timeout, up to 3 retries with jittered exponential backoff on network errors, timeouts, 429 and 5xx; honours Retry-After (waits over 30 s fail fast); results in input order; fails on count or dimension mismatch.
  - `embedQuery(text, options?)`: optional BGE instruction prefix via `QUERY_PREFIX_ENABLED` (default false; Phase 10 tests it).
  - `getUsage()` / `resetUsage()`: per-process ESTIMATE of tokens (chars/4) and neurons; `requests` = HTTP attempts including retries, `batches` = successful batches; truncation-risk counter for inputs over 1536 chars.
  - `EmbeddingError` codes: AUTH_FAILED, RATE_LIMITED, QUOTA_EXHAUSTED, BAD_RESPONSE, DIMENSION_MISMATCH, UPSTREAM_ERROR, TIMEOUT. HTTP 408 / codes 3007 and 3008 map to TIMEOUT; quota exhaustion is code 3036. Errors never contain the token or account id.
- `server/src/models/Chunk.js`: repoId, userId, path, startLine, endLine, text, embedding (select:false, length validated), expiresAt; index on repoId; TTL index on expiresAt (expireAfterSeconds 0).
- Atlas vector index `chunks_vector` on `askarepo.chunks`: embedding, 768 dims, cosine, `repoId` filter field (1 of 3 free search indexes used). Created manually in the Atlas UI.
- `server/scripts/vector-test.js` (load / search / cleanup): 10 test chunks under dummy ids, expiring after one day; manual $vectorSearch with filter, numCandidates 100, limit 5, prints scores.
- `server/scripts/embed-smoke.js`: 3 docs + 1 query.
- Tests: 153 total, all passing, no network. Nothing tests the real index (D-008 limit).
- `DECISIONS.md` has D-001 to D-024.

## What is broken

- Nothing known. `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` must be set in Render's environment, or the deploy crashes at boot.
- Unconfirmed: max items per request (batch of 32 assumed safe), Cloudflare daily reset time (assumed 00:00 UTC).
- Neuron usage is an estimate (chars/4 undercounts code). The 512-token limit is not enforced; the 1500-char cap and 1536-char risk threshold are estimates, so some chunks may be silently truncated. Measured in Phase 10.
- Open: whether the vector index counts toward the 512 MB on M0, and whether BSON float32 binary vectors are usable with the current driver. Not measured.
- Score threshold not set: BGE scores are compressed. Test scores (on-topic vs off-topic) from 4B are the first data points; calibrated in Phase 10.
- GitHub rate-limit accounting for downloads is still an assumption. A 404 on one file reports the generic message. Long-line segments can split a surrogate pair (accepted). Chunking defaults are untuned until Phase 10.
- No Repo model, no ingest route, no background indexing, no client changes yet.

## Files added or changed

- Added (4B): `server/src/models/Chunk.js`, `server/scripts/vector-test.js`
- Changed (4B): `DECISIONS.md` (D-023, D-024), `STATUS.md`

## Next

**Phase 5 — Ingest pipeline:** Repo model, `POST /api/repos` (202), background fetch, chunk, embed, bulk insert, status transitions, `GET /api/repos`, `GET /api/repos/:id`, `DELETE /api/repos/:id`, boot-time cleanup of repos stuck in `indexing`.
