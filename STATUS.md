# Status

## Current phase

Phase 6 complete (retrieval). Next: Phase 7 — Answer generation.

## What works

- Live at https://ask-a-repo.onrender.com (Render free, auto-deploy from main). Phases 0 to 5: /healthz, React shell, auth, GitHub client, chunker (defaults 50 / 10 / 1500), embeddings service (Cloudflare Workers AI, 768 dims), Chunk model, Atlas vector index `chunks_vector`, ingest pipeline and repo routes.
- Phase 5: Repo model (7-day TTL, demo exempt), `services/ingest.js`, limits (3 repos per user, one active ingest per user, 2 concurrent, 10 minute limit), boot recovery, `/api/repos` POST, GET, GET :id, DELETE behind requireAuth.
- Phase 6: `services/retrieve.js` with `retrieve({ repoId, query, limit = 5 })` and pure `mergeAdjacentHits`. `$vectorSearch` with repoId filter inside the query, NUM_CANDIDATES 100, CANDIDATE_LIMIT 8, embedding `$unset`. Adjacent hits merged (overlap or touch), max score, no duplicated lines, MAX_MERGED_CHARS 4500, single-line hits (long-line segments) never merged. No score threshold.
- Route `POST /api/repos/:id/search { question }` (1 to 500 chars): owner-checked 404, 409 REPO_NOT_READY before retrieval, EmbeddingError mapping (QUOTA_EXHAUSTED and RATE_LIMITED 503, others 502), allowlisted hits with SHA-pinned GitHub URLs, response `{ hits, repo: { id, commitSha } }`.
- `scripts/retrieve-test.js` (single question, `--expect`, `--file` questions.json with hit@5 count): the seed for the Phase 10 eval.
- Tests: all passing, no network. New: retrieve.test.js, search.routes.test.js. Fixed a duplicate import in test/app.js.
- `DECISIONS.md` has D-001 to D-038.

## What is broken

- Nothing known. Phase 6 live checks (curl and retrieve-test.js) must be run by you.
- No rate limiting yet (Phase 12): search embeds one query per call and spends the shared Cloudflare quota. Do not share the link widely.
- No client UI yet (Phase 8). No cancel button for an indexing repo (D-033).
- Search returns hits for off-topic questions: there is no threshold until Phase 10 calibration.
- NUM_CANDIDATES 100, CANDIDATE_LIMIT 8 and MAX_MERGED_CHARS 4500 are untuned guesses.
- Single-line chunks are never merged (D-036); no segment offset is stored.
- Ownership relies on the route check; userId is not in the vector index (D-024).
- Recovery and concurrency assume a single instance (D-027).
- The fakes do not prove real Mongo behaviour, including `$vectorSearch`; the live checks cover that.
- Still unmeasured or unconfirmed: embedding batch limit, Cloudflare reset time, whether the vector index counts toward 512 MB, truncation at 512 tokens, GitHub download rate-limit accounting, score threshold, chunking defaults (Phase 10).
- Updating isDemo on an existing repo must also $unset expiresAt.

## Files added or changed (Phase 6)

- Added: `server/src/services/retrieve.js`, `server/scripts/retrieve-test.js`, `server/test/retrieve.test.js`, `server/test/search.routes.test.js`
- Changed: `server/src/routes/repos.js`, `server/test/app.js` (duplicate import), `DECISIONS.md` (D-034 to D-038), `STATUS.md`

## Next

**Phase 7:** `services/llm.js` (Groq, 70B with 8B fallback), token-budgeted prompt builder, `POST /api/repos/:id/ask` reusing `retrieve()`, citations `[n]`, `messages` collection, not-found path (threshold stays a placeholder until Phase 10).
