# Status

## Current phase

Phase 10B — evaluation harness, threshold sweep, and no-tests experiment completed. The remaining retrieval-parameter experiments are pending. Next: complete those experiments, consolidate the findings, then move to Phase 10C.

## What works

- Live at https://ask-a-repo.onrender.com (Render free, auto-deploy from `main`). Phases 0 to 9 as before: authentication, GitHub client, chunker (window 50 / overlap 10 / max-chars 1500), embeddings (Cloudflare Workers AI, 768 dimensions), Atlas vector index `chunks_vector`, ingestion, retrieval, Groq answers (`openai/gpt-oss-120b`, fallback `openai/gpt-oss-20b`), streaming ask, and React client.
- Evaluation (Phase 10): `server/scripts/eval.js` writes `server/eval/runs/<label>.md` and `.json` with per-question results (ID, kind, top score, top-five paths with line ranges and scores, and rank of the first expected-file hit), then appends to `server/eval/results.csv`.
- Evaluation supports the `overview` question kind and `--exclude-tests on|off` (evaluation only, D-086). `server/eval/threshold-sweep.js <label>` evaluates thresholds from 0.70 to 0.90 in 0.005 increments and does not modify production configuration.
- `SEARCH_MIN_SCORE` default is now **0.79** (provisional, D-084). Tests override it with `0.6` in `vitest.config.js`.
- Current baseline: 30 on-topic and 8 off-topic questions, across two repositories, with 873 chunks. On-topic retrieval: Hit@1 36.7%, Hit@3 73.3%, Hit@5 80.0%, MRR 0.547, average rank 1.917.
- Baseline on-topic top scores: min 0.799, p25 0.852, median 0.860, p75 0.873, max 0.889. Off-topic top scores: min 0.767, p25 0.781, median 0.790, p75 0.816, max 0.845. The distributions overlap.
- Threshold sweep: at 0.790, 30/30 on-topic questions pass, 4/8 off-topic questions are rejected, and 6/6 overview questions pass. At 0.800, 29/30 on-topic questions pass and 5/6 overview questions pass. The 0.79 threshold remains provisional because the evaluation set is small and score distributions overlap.
- No-tests experiment: excluding 58 test files reduced the corpus from 873 to 560 chunks. On-topic Hit@1 improved from 36.7% to 46.7%, Hit@3 from 73.3% to 86.7%, Hit@5 from 80.0% to 86.7%, and MRR from 0.547 to 0.650. Both exact-identifier misses (`im-exact-02` and `im-exact-03`) became top-five hits. Production indexing remains unchanged (D-086).
- Server tests: `npm --prefix server test` — **538 tests across 23 files passed**. The suite runs without network access.
- `DECISIONS.md` contains D-001 through D-086.

## What is broken or unverified

- Retrieval-parameter experiments still pending: `qprefix-on`, `merge-off`, `prefix-off`, `w30`, `c3000`, and `o0`. Their results remain `TBD` in `server/eval/FINDINGS.md`.
- Four on-topic retrieval failures remain after excluding tests: `im-concept-03`, `im-multi-01`, `im-overview-01`, and `im-overview-02`.
- Threshold selection is provisional. The evaluation dataset contains only 30 on-topic and 8 off-topic questions across two repositories. One on-topic question changes Hit@5 by 3.3 percentage points; one off-topic question changes the rejection rate by 12.5 points.
- `results.csv` intentionally retains its existing schema without an overview or exclude-tests column. Run labels distinguish experiments; per-question and group details are in the JSON and Markdown reports.
- Window and max-chars interact (D-079). The 512-token check is a chars/4 estimate. Running two evaluation jobs concurrently could cause them to delete each other's temporary chunks (D-081).
- Phase 9A and 9B manual checks, Groq streaming assumptions, SSE proxy buffering on Render, and shutdown waiting on open SSE connections remain as previously documented; this status update does not re-verify them.
- No rate limiting until Phase 12, so do not share the link widely. Follow-up questions retrieve using the raw question (Phase 11).

## Files added or changed (Phase 10B)

- Added: `server/eval/threshold-sweep.js`, `server/eval/FINDINGS.md`.
- Added/updated evaluation data and outputs: `server/eval/questions.json` (six overview questions added), `server/eval/questions.example.json`, `server/eval/runs/baseline.md`, `server/eval/runs/baseline.json`, `server/eval/runs/no-tests.md`, `server/eval/runs/no-tests.json`, and `server/eval/results.csv`.
- Changed: `server/eval/lib.js`, `server/scripts/eval.js`, `server/src/config.js`, `server/src/services/answer.js` (comment), `.env.example`, `server/test/evalLib.test.js`, `DECISIONS.md` (D-082 through D-086), and `STATUS.md`.

## Next

Run the remaining retrieval-parameter experiments (`qprefix-on`, `merge-off`, `prefix-off`, `w30`, `c3000`, and `o0`). Fill the corresponding `TBD` cells in `server/eval/FINDINGS.md`, compare each result against the current 38-question baseline, and decide whether any chunking or retrieval defaults should change. Keep test exclusion evaluation-only unless further evidence supports a production change. Then proceed to Phase 10C (README results table and Explain-back).
