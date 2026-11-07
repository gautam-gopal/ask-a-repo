# Status

## Current phase

Phase 12A done (abuse protection and hardening). Next: 12B (CI, protections table, final audit). Phase 11 (hybrid search, follow-up rewrite) is still skipped; it is first on the PROJECT.md cut list.

## What works

- Live at https://ask-a-repo.onrender.com (Render free, auto-deploy from `main`). Phases 0 to 10: auth, GitHub client, chunker (50 / 10 / 1500), embeddings (Cloudflare Workers AI, 768 dims), vector index `chunks_vector`, ingest pipeline, repo routes, retrieval, Groq answers (gpt-oss-120b, fallback gpt-oss-20b), ask and SSE streaming, messages, React client, retrieval eval.
- Production indexing skips test and spec files (INDEX_EXCLUDE_TESTS, D-087). SEARCH_MIN_SCORE 0.795, provisional (D-089). Eval: baseline hit@5 80.0%, B2 86.7% (30 questions); test-targeted cost measured (FINDINGS section 7: 0/4 with exclusion, 4/4 without).
- 12A: `trust proxy` (TRUST*PROXY, default 1); rate limits in `middleware/rateLimit.js` (signup 5/h/IP, login 10/15 min/IP failures only, ask+stream+search 20/10 min/user + 60/10 min/IP, ingest 5/day/user + 10/day/IP, general 300/15 min/IP with repo-read GETs skipped), all 429 TOO_MANY_REQUESTS with Retry-After and RateLimit-\* headers, all overridable via RL*\* env.
- 12A: global daily budget guard (`usage` collection, DAILY_NEURON_BUDGET 8000, DAILY_LLM_REQUEST_BUDGET 500) refusing ingest, ask and search with 503 DAILY_BUDGET; reads never blocked. Signup cap MAX_USERS 200 (503 SIGNUPS_CLOSED).
- 12A: helmet with strict CSP (no unsafe-inline), 16 KB body limit with 413, JSON 404 for unknown /api routes, request log (id, method, route, status, ms, userId) with X-Request-Id, `redact()` in the central error logger, client-caused 4xx no longer become 500. App wiring is now `server/src/app.js`, shared by `index.js` and the tests.
- `DECISIONS.md` contains D-001 to D-097.
- Latest server test run: TODO (expect all green, about 571 tests in 25 files).

## What is broken or unverified

- Render's real proxy hop count is unverified: run the RateLimit-Remaining check (D-091) and set TRUST_PROXY if needed.
- The CSP has not been checked against the real production build in a browser (D-096).
- DAILY_LLM_REQUEST_BUDGET 500 is a placeholder: set it from the Groq dashboard limits for both models.
- Budget numbers are estimates and do not capture failed calls, retries, tokens-per-minute or Cloudflare's real billing (D-094).
- In-memory limiters reset on restart and do not work across instances (D-093).
- Existing repos in the database still contain test chunks: delete and re-add them.
- Four B2 retrieval failures remain; the eval sample is small and tuned on itself (FINDINGS section 8).
- Other ad-hoc log lines that print err.message are not redacted (D-097).
- 9A/9B manual checks, Groq streaming assumptions, SSE buffering on Render and shutdown with open SSE connections are as documented previously.
- Still unmeasured: embedding batch limit, Cloudflare reset time, vector index storage, GitHub download accounting.

## Files added or changed (12A)

- Added: `server/src/app.js`, `server/src/redact.js`, `server/src/middleware/rateLimit.js`, `signupCap.js`, `budget.js`, `requestLog.js`, `server/src/models/Usage.js`, `server/src/services/usage.js`, `server/test/fakeUsage.js`, `server/test/hardening.test.js`.
- Changed: `server/src/config.js`, `server/src/index.js`, `server/src/middleware/errors.js`, `server/src/routes/auth.js`, `server/src/routes/repos.js`, `server/src/services/ingest.js`, `server/test/app.js`, `server/test/setup.js`, `server/test/fakeUser.js`, `server/vitest.config.js`, `server/package.json` (express-rate-limit, helmet), `.env.example`, `DECISIONS.md`, `STATUS.md`.

## Next

1. Run the Render checks from 12A Verify (IP check, CSP console check, 413, 404).
2. Set DAILY_LLM_REQUEST_BUDGET on Render from your Groq limits.
3. 12B: CI (GitHub Actions), a protections table in the README, final audit and the abuse checklist.
