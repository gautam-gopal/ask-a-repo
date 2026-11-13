# Status

## Current phase

Phase 14A done (design system, app shell, login and repos pages). Next: 14B (safe Markdown rendering and citations), then 14C (chat page layout, sources, composer, final checks). Phases 0 to 10, 12 and 13 are done; Phase 11 (hybrid search) was skipped and Docker deferred (D-098).

## What works

- Live at https://ask-a-repo.onrender.com (Render free, auto-deploy from `main`): auth, GitHub client, chunker (50 / 10 / 1500), embeddings (Cloudflare Workers AI, 768 dims), vector index `chunks_vector`, ingest, retrieval, Groq answers (gpt-oss-120b, fallback gpt-oss-20b), SSE streaming, messages, React client, retrieval eval, rate limits, daily budgets, signup cap, CSP, redacted logs, CI, demo mode.
- 14A: tokens in `client/src/styles/tokens.css`, conventions in `client/DESIGN.md`, restyled header, demo notice bar, login (demo CTA, divider, segmented sign in / sign up, inline validation), repos page (count vs limit, grid of cards, native progress bar, inline delete confirm, empty and loading states). No inline styles (D-108), system fonts (D-107), one accent (D-106), light only (D-109), no UI library (D-110).
- Production indexing skips test files (D-087). SEARCH_MIN_SCORE 0.795, provisional (D-089).
- Eval (30 on-topic, 8 off-topic, 2 repos): baseline hit@5 80.0%, B2 86.7%. Test-targeted: 0/4 with exclusion, 4/4 without.
- DECISIONS.md contains D-001 to D-110. BUGS.md contains B-001.

## What is broken or unverified

- 14A manual checks (widths 360, 768, 1280, 1920; CSP console) not yet recorded here.
- Chat page still uses legacy class names and shows raw Markdown text; fixed in 14B and 14C.
- Demo: confirm the seed was run and DEMO_ENABLED / DEMO_PASSWORD are set on Render. Demo video link is a TODO in README.md.
- server/eval/FINDINGS.md section 9 still says to fill section 7; section 7 is already filled.
- Demo follow-up questions have no context; visitors behind one NAT share a demo rate-limit bucket.
- DAILY_LLM_REQUEST_BUDGET 500 is a placeholder: set it from the Groq dashboard.
- Budgets are estimates; in-memory limiters reset on restart and do not work across instances.
- Existing non-demo repos indexed before test exclusion still contain test chunks.
- Four B2 retrieval failures remain; the eval sample is small and tuned on itself.
- Secret-history check and `npm audit` results are not recorded here yet.
- No Docker image and no lint (D-098). Client has no test runner (pure helpers are tested from server/test).

## Files added or changed (14A)

- Added: `client/src/styles/tokens.css`, `client/DESIGN.md`, `client/src/authHelpers.js`, `server/test/authHelpers.test.js`.
- Changed: `client/src/styles.css`, `client/src/main.jsx`, `client/src/components.jsx`, `client/src/pages/LoginPage.jsx`, `client/src/pages/ReposPage.jsx`, `client/src/repoHelpers.js`, `DECISIONS.md`, `STATUS.md`.

## Next

14B: safe Markdown rendering for answers (sanitiser decision first, D-053 and D-057 still apply) and citation chips.
