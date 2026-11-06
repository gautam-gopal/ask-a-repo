# Status

## Current phase

Phase 10A complete (evaluation harness). Next: 10B, threshold calibration and writing the findings into the project docs.

## What works

- Live at https://ask-a-repo.onrender.com (Render free, auto-deploy from main). Phases 0 to 9: /healthz, auth, GitHub client, chunker (50 / 10 / 1500), embeddings (Cloudflare Workers AI, 768 dims), Chunk model, Atlas vector index `chunks_vector`, ingest pipeline, repo routes, retrieval and search, Groq answers (gpt-oss-120b, fallback gpt-oss-20b), `POST /api/repos/:id/ask`, `POST /api/repos/:id/ask/stream` (SSE), `GET /api/repos/:id/messages`, React client (auth, repos page, streaming chat page).
- Phase 10A (scripts and tests only, no route or client change): `server/scripts/eval.js` (retrieval-only eval: throwaway chunks under a fixed eval userId, real $vectorSearch, file-level hit@1/3/5, MRR, average rank, per question kind, off-topic top-score distribution, chunk stats, neurons), `server/eval/lib.js` (pure helpers), `server/eval/compare.js`, `server/eval/questions.example.json`. Output goes to `server/eval/results.csv` and `server/eval/runs/<label>.md`. Embeddings and repo snapshots are cached in `server/eval/.cache/` (gitignored).
- `retrieve.js` now exports `retrieveByVector` (merge on or off); `retrieve()` is unchanged in behaviour. `embeddings.js` exports `QUERY_PREFIX`.
- Tests: `npm --prefix server test` (no network). New: evalLib.test.js, 2 retrieveByVector tests in retrieve.test.js.
- `DECISIONS.md` has D-001 to D-081.

## What is broken or unverified

- 10A manual checks (dry run, first real run, cleanup check in Atlas) pending until you run them.
- `server/eval/questions.json` is not written yet (you write it; aim for about 32 questions: 8 exact-identifier, 10 conceptual, 6 multi-file, 8 off-topic).
- No eval results exist yet, so every default (50 / 10 / 1500, path prefix, query prefix off, NUM_CANDIDATES 100) is still unmeasured. SEARCH_MIN_SCORE 0.5 is still a placeholder (10B).
- The 1500-character cap often shortens the 50-line window, so window and max-chars interact (D-079).
- The 512-token check is a chars/4 estimate; the embedding model silently truncates beyond it.
- Two eval runs at the same time would delete each other's chunks (D-081).
- 9A and 9B manual checks (local, then Render) pending. Groq streaming details are assumptions until groq-stream-probe.js is run. Proxy buffering on Render for SSE is unchecked.
- Graceful shutdown waits for open SSE connections, so a deploy or Ctrl+C can hang until streams end.
- A "[1]" inside an unclosed code fence can briefly render as a chip mid-stream (D-069).
- Client does not read Retry-After (D-055, D-059). Active repos show a Delete button that always ends in the 409 (D-056). A network failure during the first /api/me looks like signed out (D-051).
- No rate limiting until Phase 12, so do not share the link widely. Follow-ups retrieve on the raw question (Phase 11).
- Still unmeasured: embedding batch limit, Cloudflare reset time, vector index storage, GitHub download accounting.

## Files added or changed (Phase 10A)

- Added: `server/scripts/eval.js`, `server/eval/lib.js`, `server/eval/compare.js`, `server/eval/questions.example.json`, `server/test/evalLib.test.js`
- Changed: `server/src/services/retrieve.js` (retrieveByVector), `server/src/services/embeddings.js` (export QUERY_PREFIX), `server/test/retrieve.test.js` (import and 2 tests), `.gitignore` (server/eval/.cache/), `DECISIONS.md` (D-077 to D-081), `STATUS.md`

## Next

**10B:** write questions.json, run the experiment plan (priority: baseline, qprefix-on, merge-off, prefix-off, w30, c3000, o0), set chunk and retrieval defaults from the data, calibrate SEARCH_MIN_SCORE from the on-topic versus off-topic top scores, and record the findings in DECISIONS.md and the README results table.
