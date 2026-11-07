# Status

## Current phase

Phase 12 done (12A abuse protection, 12B CI, protections doc, audit). Next: Phase 13 (ship). Phase 11 (hybrid search, follow-up rewrite) is skipped; Docker is deferred (D-098).

## What works

- Live at https://ask-a-repo.onrender.com (Render free, auto-deploy from `main`). Phases 0 to 10 plus 12: auth, GitHub client, chunker (50 / 10 / 1500), embeddings (Cloudflare Workers AI, 768 dims), vector index `chunks_vector`, ingest pipeline, repo routes, retrieval, Groq answers (gpt-oss-120b, fallback gpt-oss-20b), SSE streaming, messages, React client, retrieval eval.
- Production indexing skips test files (D-087). SEARCH_MIN_SCORE 0.795, provisional (D-089). Eval: baseline hit@5 80.0%, B2 86.7% (30 questions).
- 12A: rate limits, daily budgets, signup cap, helmet CSP, 16 KB body limit, request log with redaction (D-091 to D-097).
- 12B: GitHub Actions CI on push and pull request to main (server tests, client build, no secrets, no network, no database), docs/PROTECTIONS.md, route and security audit, redaction added to the remaining `err.message` logs (D-098, D-099).
- DECISIONS.md contains D-001 to D-099.

## What is broken or unverified

- Render's real proxy hop count (TRUST_PROXY) and the CSP against the production build are unchecked.
- DAILY_LLM_REQUEST_BUDGET 500 is a placeholder: set it from the Groq dashboard.
- Budgets are estimates; in-memory limiters reset on restart and do not work across instances.
- Existing repos in the database still contain test chunks: delete and re-add them.
- Four B2 retrieval failures remain; the eval sample is small and tuned on itself.
- Secret-history check and `npm audit` results: record them here after running.
- No Docker image and no lint (D-098).

## Files added or changed (12B)

- Added: `.github/workflows/ci.yml`, `docs/PROTECTIONS.md`.
- Changed: `README.md` (badge, link), `server/src/index.js` and `server/src/services/ingest.js` (redact in error logs), `DECISIONS.md`, `STATUS.md`.

## Next

1. Confirm the first CI run is green; run the audit commands and fix any high or critical findings.
2. Phase 13: demo repos, README, demo video, resume bullets from measured numbers only.
