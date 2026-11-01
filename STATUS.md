# Status

## Current phase

Phase 4A complete (embeddings service). Next: Phase 4B — Chunk model, Atlas vector index, manual vector search.

## What works

- Live at https://ask-a-repo.onrender.com (Render free, auto-deploy from main). Phases 0 to 3 unchanged: /healthz, React shell, auth, GitHub client, chunker (defaults 50 / 10 / 1500).
- `server/src/services/embeddings.js` (Cloudflare Workers AI, `@cf/baai/bge-base-en-v1.5`, 768 dims, cls pooling; the only file that knows the provider):
  - `embedDocuments(texts, options?)`: batches of 32, concurrency 2, 20 s timeout, up to 3 retries with jittered exponential backoff on network errors, timeouts, 429 and 5xx; honours Retry-After (waits over 30 s fail fast); results in input order; fails on count or dimension mismatch.
  - `embedQuery(text, options?)`: optional BGE instruction prefix via `QUERY_PREFIX_ENABLED` (default false; Phase 10 tests it).
  - `getUsage()` / `resetUsage()`: per-process ESTIMATE of tokens (chars/4) and neurons; `requests` = HTTP attempts including retries, `batches` = successful batches; truncation-risk counter for inputs over 1536 chars.
  - `EmbeddingError` codes: AUTH_FAILED, RATE_LIMITED, QUOTA_EXHAUSTED, BAD_RESPONSE, DIMENSION_MISMATCH, UPSTREAM_ERROR, TIMEOUT. HTTP 408 / codes 3007 and 3008 map to TIMEOUT; quota exhaustion is Cloudflare error code 3036. Errors never contain the token or account id.
- Config: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` (required); `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS` (768), `QUERY_PREFIX_ENABLED` (optional).
- `server/scripts/embed-smoke.js`: 3 docs + 1 query (4 embeddings), prints lengths, latency, cosine scores, estimated neurons.
- Tests: 153 total (126 + 27 embeddings tests), all passing, no network.
- `DECISIONS.md` has D-001 to D-022. `PROJECT.md` updated for Cloudflare.

## What is broken

- Nothing known. `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` must be set in Render's environment, or the deploy crashes at boot.
- Confirmed from Cloudflare docs and a live 3-text test: endpoint, array input, cls pooling, 768 dims, 512-token limit, 10,000 neurons/day, 3,000 requests/min. Still unconfirmed: max items per request (batch of 32 assumed safe), daily reset time (assumed 00:00 UTC).
- Neuron usage is an estimate (chars/4 undercounts code). The API reports no usage.
- The 512-token limit is not enforced. The 1500-char cap and 1536-char risk threshold are estimates; some chunks may be silently truncated by the model. Measured in Phase 10.
- GitHub rate-limit accounting for downloads is still an assumption. A 404 on one file reports the generic message. Long-line segments can split a surrogate pair (accepted). Chunking defaults are untuned until Phase 10.
- No Chunk model, no vector index, no ingestion route yet; nothing is stored.

## Files added or changed

- Added: `server/src/services/embeddings.js`, `server/test/embeddings.test.js`, `server/scripts/embed-smoke.js`
- Changed: `server/src/config.js`, `server/vitest.config.js`, `.env.example`, `PROJECT.md`, `DECISIONS.md` (D-019 to D-022), `STATUS.md`

## Next

**Phase 4B — Vector storage and search:** Chunk model, Atlas vector index on `chunks.embedding` (cosine, 768 dims, `repoId` filter field), manual `$vectorSearch` over about 10 chunks. Check whether the vector index counts toward the 512 MB, and whether BSON float32 vectors are supported (about 3 KB per vector instead of 9.9 KB). No ingestion route, background indexing or client changes.
