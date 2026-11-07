# Status

## Current phase

Phase 10 done (evaluation, B2 adopted, threshold 0.795, findings, README evaluation section). Next: Phase 12 (hardening). Phase 11 (hybrid search, follow-up rewrite) is skipped for now; it is the first item on the PROJECT.md cut list.

## What works

- Live at https://ask-a-repo.onrender.com (Render free, auto-deploy from `main`). Phases 0 to 9: auth, GitHub client, chunker (50 / 10 / 1500), embeddings (Cloudflare Workers AI, 768 dims), vector index `chunks_vector`, ingest pipeline, repo routes, retrieval, Groq answers (gpt-oss-120b, fallback gpt-oss-20b), ask and SSE streaming routes, messages, React client.
- Phase 10: retrieval-only eval (`server/scripts/eval.js`, `server/eval/*`), 38 questions over two repos (30 on-topic, 8 off-topic) plus 4 test-targeted. Results and caveats in `server/eval/FINDINGS.md` and the README Evaluation section.
- Production indexing now skips test and spec files (`INDEX_EXCLUDE_TESTS`, default true, D-087). The eval uses the same flag and the same matcher (`services/testPaths.js`).
- `SEARCH_MIN_SCORE` default 0.795, provisional (D-089).
- Measured: baseline hit@5 80.0%, MRR 0.547; B2 hit@5 86.7%, MRR 0.650 (30 questions, file-level hit).
- Latest server test run: TODO (expected 550 tests in 24 files).
- `DECISIONS.md` contains D-001 to D-090.

## What is broken or unverified

- Existing repos in the database still contain test chunks. Delete and re-add them.
- test-targeted results (cost of excluding tests) not run yet: FINDINGS section 7 is TODO.
- Four B2 failures remain (im-concept-03, im-multi-01, im-overview-01, im-overview-02); causes in FINDINGS are guesses.
- Eval sample is small, written by me, and B2 and the threshold were chosen on the same questions. B2 is confounded by removing 36% of chunks.
- The 0.795 threshold has a 0.004 margin set by one question; 4/8 off-topic questions still reach the model.
- 9A/9B manual checks, Groq streaming assumptions, SSE buffering on Render and shutdown with open SSE connections are as documented previously.
- No rate limiting until Phase 12, so do not share the link widely. Follow-ups retrieve on the raw question.
- Still unmeasured: embedding batch limit, Cloudflare reset time, vector index storage, GitHub download accounting.

## Files added or changed (Phase 10C)

- Added: `server/src/services/testPaths.js`, `server/test/testExclusion.test.js`, `README.md`.
- Changed: `server/src/config.js`, `server/src/services/github.js`, `server/src/services/ingest.js`, `server/src/services/answer.js` (comment), `server/eval/lib.js`, `server/scripts/eval.js`, `server/scripts/ingest-run.js`, `server/eval/questions.json`, `server/eval/FINDINGS.md`, `server/test/ingest.test.js`, `server/test/evalLib.test.js`, `.env.example`, `DECISIONS.md`, `STATUS.md`.

## Next

1. Run the two test-targeted evals and fill FINDINGS section 7.
2. Delete and re-add your repos so they use the exclusion.
3. Phase 12: rate limits, caps, helmet, request logs, Docker, CI.
