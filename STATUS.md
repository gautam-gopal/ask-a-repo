# Status

## Current phase

Phase 13A done (demo mode). Next: 13B (README, docs, demo video, resume bullets). Phase 11 (hybrid search, follow-up rewrite) is skipped; Docker is deferred (D-098).

## What works

- Live at https://ask-a-repo.onrender.com (Render free, auto-deploy from `main`). Phases 0 to 10 and 12: auth, GitHub client, chunker (50 / 10 / 1500), embeddings (Cloudflare Workers AI, 768 dims), vector index `chunks_vector`, ingest, retrieval, Groq answers (gpt-oss-120b, fallback gpt-oss-20b), SSE streaming, messages, React client, retrieval eval, rate limits, daily budgets, signup cap, CSP, redacted logs, CI.
- Production indexing skips test files (D-087). SEARCH_MIN_SCORE 0.795, provisional (D-089). Eval: baseline hit@5 80.0%, B2 86.7% (30 questions).
- 13A demo mode (D-100 to D-105): "Try the demo" signs in the one `isDemo` user with a 2 hour cookie, no credentials. Add and delete are 403 DEMO_READ_ONLY. Demo limits are keyed by IP. Demo sessions get no history and demo messages expire after 24 hours. `server/scripts/seed-demo.js` is idempotent, dry-run by default, and respects the daily neuron budget.
- DECISIONS.md contains D-001 to D-105.

## What is broken or unverified

- Demo needs the seed run and DEMO_ENABLED, DEMO_PASSWORD set on Render; the curl and browser checks have not been run yet.
- Demo follow-up questions have no context (no history for the shared user).
- Visitors behind one NAT share a demo rate-limit bucket.
- DAILY_LLM_REQUEST_BUDGET 500 is a placeholder: set it from the Groq dashboard.
- Budgets are estimates; in-memory limiters reset on restart and do not work across instances.
- Existing non-demo repos in the database still contain test chunks: delete and re-add them.
- Four B2 retrieval failures remain; the eval sample is small and tuned on itself.
- Secret-history check and `npm audit` results: record them here after running.
- No Docker image and no lint (D-098). Client has no test runner; demo UI is checked manually.

## Files added or changed (13A)

- Added: `server/src/middleware/demo.js`, `server/src/services/demoSeed.js`, `server/scripts/seed-demo.js`, `server/test/demo.test.js`.
- Changed: `server/src/config.js`, `redact.js`, `app.js`, `models/User.js`, `middleware/auth.js`, `middleware/rateLimit.js`, `routes/auth.js`, `routes/repos.js`, `services/ingest.js`, `server/vitest.config.js`, `server/test/fakeUser.js`, `server/test/ask.routes.test.js`, `server/test/ingest.test.js`, `.env.example`, `client/src/api.js`, `auth.jsx`, `components.jsx`, `pages/LoginPage.jsx`, `pages/ReposPage.jsx`, `styles.css`, `DECISIONS.md`, `STATUS.md`.

## Next

1. Set DEMO_ENABLED and DEMO_PASSWORD on Render, run the seed script, run the Verify checks.
2. 13B: README (what and why, live link, Mermaid architecture, eval table, decisions, limitations, setup, cold-start note), demo video, resume bullets from measured numbers only.
