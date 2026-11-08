# Status

## Current phase

Phase 13 done (13A demo mode, 13B README and docs). Project complete. Phase 11 (hybrid search, follow-up rewrite) was skipped; Docker was deferred (D-098).

## What works

- Live at https://ask-a-repo.onrender.com (Render free, auto-deploy from `main`). Phases 0 to 10, 12 and 13: auth, GitHub client, chunker (50 / 10 / 1500), embeddings (Cloudflare Workers AI, 768 dims), vector index `chunks_vector`, ingest, retrieval, Groq answers (gpt-oss-120b, fallback gpt-oss-20b), SSE streaming, messages, React client, retrieval eval, rate limits, daily budgets, signup cap, CSP, redacted logs, CI, demo mode.
- Production indexing skips test files (D-087). SEARCH_MIN_SCORE 0.795, provisional (D-089).
- Eval (30 on-topic, 8 off-topic, 2 repos): baseline hit@5 80.0%, B2 86.7%. Test-targeted: 0/4 with exclusion, 4/4 without (FINDINGS section 7).
- README covers live link, architecture (Mermaid), stack, engineering highlights, evaluation with caveats, security summary, limitations, next steps and local setup. docs/PROTECTIONS.md holds limits and limitations.
- DECISIONS.md contains D-001 to D-105. BUGS.md contains B-001.

## What is broken or unverified

- Demo: confirm the seed was run and DEMO_ENABLED / DEMO_PASSWORD are set on Render, and that "Try the demo" works live. Update this line once checked.
- Demo video link is a TODO in README.md (HTML comment in the Live section).
- server/eval/FINDINGS.md section 9 still says to fill section 7; section 7 is already filled. Edit when convenient.
- Demo follow-up questions have no context; visitors behind one NAT share a demo rate-limit bucket.
- DAILY_LLM_REQUEST_BUDGET 500 is a placeholder: set it from the Groq dashboard.
- Budgets are estimates; in-memory limiters reset on restart and do not work across instances.
- Existing non-demo repos indexed before test exclusion still contain test chunks.
- Four B2 retrieval failures remain; the eval sample is small and tuned on itself.
- Secret-history check and `npm audit` results are not recorded here yet.
- No Docker image and no lint (D-098). Client has no test runner.

## Files added or changed (13B)

- Changed: `README.md`, `STATUS.md`.

## Next

Nothing required. Optional: record the demo video and add its link, run the unverified checks above, then decide whether to start Phase 11 or the stretch item (AST chunking).
