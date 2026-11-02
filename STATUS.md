# Status

## Current phase

Phase 7A complete (LLM service, prompt, answer logic). Next: Phase 7B, the ask route.

## What works

- Live at https://ask-a-repo.onrender.com (Render free, auto-deploy from main). Phases 0 to 6: /healthz, React shell, auth, GitHub client, chunker (50 / 10 / 1500), embeddings (Cloudflare Workers AI, 768 dims), Chunk model, Atlas vector index `chunks_vector`, ingest pipeline, repo routes, retrieval (`retrieve()`, merge adjacent hits) and `POST /api/repos/:id/search`.
- Phase 7A: `services/llm.js` (only Groq file): `chat`, `generate` with openai/gpt-oss-120b then one openai/gpt-oss-20b fallback on RATE_LIMITED or MODEL_UNAVAILABLE (defaults changed from the retired Llama models), request uses max_completion_tokens.
- `services/prompt.js` (pure): `buildMessages` (system rules, delimited excerpts, last 4 history turns, 3000 estimated token budget, lowest score dropped first, renumbered), `extractCitations` (invalid [n] removed).
- `services/answer.js`: `answerQuestion` returns notFound without calling the LLM when there are no hits or the best score is below SEARCH_MIN_SCORE.
- `scripts/ask-test.js <repoId> "<question>" --yes`.
- New env vars: GROQ_API_KEY (required), GROQ_MODEL, GROQ_FALLBACK_MODEL, SEARCH_MIN_SCORE.
- Tests: all passing, no network. New: prompt.test.js, llm.test.js, answer.test.js.
- `DECISIONS.md` has D-001 to D-044.

## What is broken

- Primary-model live smoke test passed locally using openai/gpt-oss-120b. Fallback live testing has not been forced; fallback behaviour is covered by mocked tests. Render environment variables and deployment remain unverified.
- No ask route and no `messages` storage yet (7B). No streaming (Phase 9). No client UI (Phase 8).
- SEARCH_MIN_SCORE default 0.5 is a placeholder and filters almost nothing until the Phase 10 eval calibrates it.
- Token budget uses chars/4, an estimate; real Groq usage is only known after a call.
- Groq model names, free limits, 429 shape and model-removed error codes are unverified against current docs.
- Prompt injection is reduced, not eliminated (D-040). `a[0][1]` style code can be mistaken for a citation (D-043).
- No rate limiting yet (Phase 12): search and ask spend shared Cloudflare and Groq quota. Do not share the link widely.
- Still unmeasured: embedding batch limit, Cloudflare reset time, vector index storage, 512 token truncation, GitHub download accounting, NUM_CANDIDATES and chunking defaults (Phase 10).
- Updating isDemo on an existing repo must also $unset expiresAt.
- Live Groq smoke test with the GPT-OSS defaults not yet run. If answers come back empty (BAD_RESPONSE), reasoning tokens are eating the output cap.

## Files added or changed (Phase 7A)

- Added: `server/src/services/llm.js`, `prompt.js`, `answer.js`, `server/scripts/ask-test.js`, `server/test/llm.test.js`, `prompt.test.js`, `answer.test.js`
- Changed: `server/src/config.js`, `.env.example`, `server/vitest.config.js`, `DECISIONS.md` (D-039 to D-044), `STATUS.md`

## Next

**Phase 7B:** `POST /api/repos/:id/ask` (zod, owner check, READY check, retrieve, answerQuestion, LlmError mapping), `Message` model, history from stored messages, route tests, then the Phase 7 Explain-back.
