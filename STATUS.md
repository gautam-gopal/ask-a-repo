# Status

## Current phase

Phase 7 complete (LLM service, prompt, answer logic, ask route, message storage). Next: Phase 8, the client UI.

## What works

- Live at https://ask-a-repo.onrender.com (Render free, auto-deploy from main). Phases 0 to 6: /healthz, React shell, auth, GitHub client, chunker (50 / 10 / 1500), embeddings (Cloudflare Workers AI, 768 dims), Chunk model, Atlas vector index `chunks_vector`, ingest pipeline, repo routes, retrieval and `POST /api/repos/:id/search`.
- Phase 7A: `services/llm.js` (only Groq file) with openai/gpt-oss-120b and one openai/gpt-oss-20b fallback, `services/prompt.js`, `services/answer.js`, `scripts/ask-test.js`.
- Phase 7B: `models/Message.js` (indexes { repoId, createdAt } and TTL on expiresAt copied from the repo). `POST /api/repos/:id/ask` (auth, ownership 404, 409 REPO_NOT_READY, zod 1 to 500 chars, retrieve, last 4 answered turns as history, answerQuestion, save, respond with SHA-pinned source URLs and cited flags). `GET /api/repos/:id/messages` (last 50, oldest first, allowlisted). DELETE repo also deletes its messages.
- Ask error mapping: rate limit 503 (+ Retry-After), quota 503, auth failure generic 500 with server log, timeout 504, other upstream 502. Failed exchanges are not saved.
- Tests: new `ask.routes.test.js`; `fakeMessage` in `fakeIngestModels.js`, global Message mock in `test/setup.js`. Run `npm --prefix server test`; no network.
- `DECISIONS.md` has D-001 to D-048.

## What is broken or unverified

- Live check of the ask route on Render (Groq key, env vars, cold start) pending until the curl in the Phase 7B verify passes. Fallback model has not been forced live; covered by mocked tests only.
- SEARCH_MIN_SCORE default 0.5 is a placeholder and filters almost nothing until the Phase 10 eval calibrates it. Off-topic questions will probably reach the LLM.
- Follow-up questions retrieve on the raw question only; vague follow-ups retrieve poorly until Phase 11 query rewriting.
- If reasoning tokens eat the 700-token cap, answers come back empty (BAD_RESPONSE). Unconfirmed.
- Token budget uses chars/4, an estimate. Groq model names, free limits, 429 shape and model-removed error codes are unverified against current docs.
- Prompt injection is reduced, not eliminated (D-040). `a[0][1]` style code can be mistaken for a citation (D-043).
- No rate limiting yet (Phase 12): search and ask spend shared Cloudflare and Groq quota. Do not share the link widely.
- Messages of a deleted demo repo would never expire (no expiresAt), but delete removes them directly.
- Still unmeasured: embedding batch limit, Cloudflare reset time, vector index storage, 512 token truncation, GitHub download accounting, NUM_CANDIDATES and chunking defaults (Phase 10).
- Updating isDemo on an existing repo must also $unset expiresAt.
- No streaming (Phase 9). No client UI (Phase 8).

## Files added or changed (Phase 7B)

- Added: `server/src/models/Message.js`, `server/test/ask.routes.test.js`
- Changed: `server/src/routes/repos.js`, `server/src/index.js`, `server/test/setup.js`, `server/test/fakeIngestModels.js`, `DECISIONS.md` (D-045 to D-048), `STATUS.md`

## Next

**Phase 8:** plain-CSS client: login/signup, repo list with status badges, delete and re-index, add-repo form with polling, chat view using `/ask` and `/messages`, loading, error and empty states, "server is waking up" message.
