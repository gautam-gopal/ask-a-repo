# Status

## Current phase

Phase 10B complete: evaluation harness, expanded 38-question dataset, threshold sweep, no-tests experiment, and four B2 retrieval experiments. Next: finalize the production configuration and threshold, then complete Phase 10C.

## What works

- Live at [https://ask-a-repo.onrender.com](https://ask-a-repo.onrender.com) (Render free, auto-deploy from `main`). Phases 0 to 9: `/healthz`, auth, GitHub client, chunker (50 / 10 / 1500), embeddings (Cloudflare Workers AI, 768 dims), Chunk model, Atlas vector index `chunks_vector`, ingest pipeline, repo routes, retrieval and search, Groq answers (gpt-oss-120b, fallback gpt-oss-20b), `POST /api/repos/:id/ask`, `POST /api/repos/:id/ask/stream` (SSE), `GET /api/repos/:id/messages`, React client (auth, repos page, streaming chat page).
- Phase 10 evaluation harness: `server/scripts/eval.js` performs retrieval-only evaluation using temporary chunks and real `$vectorSearch`. It reports file-level Hit@1/3/5, MRR, average rank, question-kind metrics, off-topic score distributions, and chunk statistics. `server/eval/lib.js` contains pure helpers; `server/eval/compare.js` compares recorded runs; `server/eval/threshold-sweep.js` sweeps thresholds from 0.70 to 0.90 in 0.005 increments without changing configuration.
- Evaluation reports are written to `server/eval/runs/<label>.md` and `.json`; aggregate results are appended to `server/eval/results.csv`. Repo snapshots and embeddings are cached in `server/eval/.cache/` (gitignored).
- `retrieve.js` exports `retrieveByVector` (merge on or off); production `retrieve()` retains its existing behaviour. `embeddings.js` exports `QUERY_PREFIX`.
- Evaluation dataset: 38 questions across two repositories — 30 on-topic (8 exact-identifier, 10 conceptual, 6 multi-file, 6 overview) and 8 off-topic.
- Original 38-question baseline (873 chunks): Hit@1 36.7%, Hit@3 73.3%, Hit@5 80.0%, MRR 0.547.
- B2 (`no-tests`, evaluation-only; 560 chunks): Hit@1 46.7%, Hit@3 86.7%, Hit@5 86.7%, MRR 0.650. Both exact-identifier failures were resolved in this run.
- Four additional B2 experiments completed:
  - `b2-qprefix`: Hit@5 83.3%, MRR 0.604.
  - `b2-nomerge`: Hit@5 86.7%, MRR 0.639.
  - `b2-max1000`: Hit@5 83.3%, MRR 0.607.
  - `b2-w30o5`: Hit@5 83.3%, MRR 0.575.
- Best-performing evaluation settings were window 50, overlap 10, max-chars 1500, path prefix on, query prefix off, and merge on. Test exclusion remains an evaluation-only setting; production adoption has not been decided.
- `SEARCH_MIN_SCORE` default is currently 0.79 (provisional, D-084). At 0.790, 30/30 on-topic questions pass, 4/8 off-topic questions are rejected, and 6/6 overview questions pass. Final calibration is pending after the production configuration is selected.
- Latest server test run: 538/538 tests passed across 23 files.
- `DECISIONS.md` contains D-001 to D-086.

## What is broken or unverified

- Production adoption of test-file exclusion is undecided (D-086). The evaluation set does not yet include test-focused questions, so the cost to questions such as “how is X tested?” has not been measured.
- Four on-topic retrieval failures remain in B2: `im-concept-03`, `im-multi-01`, `im-overview-01`, and `im-overview-02`.
- The evaluation dataset is small (30 on-topic and 8 off-topic questions) and covers only two repositories. Results are indicative, not proof; one on-topic question changes Hit@5 by 3.3 percentage points.
- `SEARCH_MIN_SCORE = 0.79` is provisional and must be recalibrated with the threshold sweep after the final production configuration is chosen.
- File-level retrieval metrics do not establish whether the right lines were retrieved or whether generated answers are correct.
- The 512-token check is a chars/4 estimate; the embedding model may silently truncate beyond its token limit.
- Window and max-chars interact (D-079). Two evaluation runs at the same time could delete each other's temporary chunks (D-081).
- 9A and 9B manual checks, Groq streaming assumptions, SSE proxy buffering on Render, and shutdown waiting on open SSE connections remain as documented previously.
- A `[1]` inside an unclosed code fence can briefly render as a chip mid-stream (D-069).
- Client does not read `Retry-After` (D-055, D-059). Active repos show a Delete button that ends in 409 (D-056). A network failure during the first `/api/me` request looks like signed out (D-051).
- No rate limiting until Phase 12, so do not share the link widely. Follow-ups retrieve on the raw question (Phase 11).
- Still unmeasured: embedding batch limit, Cloudflare reset time, vector index storage, and GitHub download accounting.

## Files added or changed (Phase 10)

- Added: `server/scripts/eval.js`, `server/eval/lib.js`, `server/eval/compare.js`, `server/eval/threshold-sweep.js`, `server/eval/questions.example.json`, `server/eval/questions.json`, `server/eval/FINDINGS.md`, `server/test/evalLib.test.js`, and per-run reports under `server/eval/runs/`.
- Changed: `server/src/services/retrieve.js` (`retrieveByVector`), `server/src/services/embeddings.js` (export `QUERY_PREFIX`), `server/src/config.js` (provisional `SEARCH_MIN_SCORE` default), `server/src/services/answer.js` (threshold rationale comment), `server/scripts/eval.js`, `server/test/retrieve.test.js`, `server/test/evalLib.test.js`, `.gitignore` (ignore `server/eval/.cache/`), `.env.example`, `DECISIONS.md` (D-077 to D-086), `server/eval/results.csv`, and `STATUS.md`.

## Next

Finalize whether production ingestion should exclude test files, taking account of the missing test-focused evaluation questions. Confirm the production retrieval/chunking settings, recalibrate `SEARCH_MIN_SCORE` using the threshold sweep on the final configuration, and keep `FINDINGS.md` and this status file synchronized. Then complete Phase 10C: add the README retrieval-results table and implement Explain-back. Phase 11 (hybrid search) follows.
