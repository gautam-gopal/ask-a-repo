# Status

## Current phase

Phase 9A complete (streaming support in llm.js and the SSE ask endpoint, server only). Next: 9B, the client stream reader, Stop button and states.

## What works

- Live at https://ask-a-repo.onrender.com (Render free, auto-deploy from main). Phases 0 to 8: /healthz, auth, GitHub client, chunker (50 / 10 / 1500), embeddings (Cloudflare Workers AI, 768 dims), Chunk model, Atlas vector index `chunks_vector`, ingest pipeline, repo routes, retrieval and search, Groq answers (gpt-oss-120b, fallback gpt-oss-20b), `POST /api/repos/:id/ask`, `GET /api/repos/:id/messages`, React client (auth, repos page, chat page).
- Phase 9A (server only, client unchanged): `generateStream` and `createSseParser` in llm.js (callback API, only delta.content forwarded, fallback only before the first token, AbortSignal, idle timeout). `answerQuestionStream` in answer.js (same threshold, prompt and citation rules, `onSources` hook). `POST /api/repos/:id/ask/stream` with events sources, token, done, error; JSON errors before the stream; 15 s heartbeat; abort on disconnect; a message is saved only after a complete answer. The non-streaming ask route is unchanged.
- Tests: `npm --prefix server test` (no network). New: llm.stream.test.js, ask.stream.routes.test.js. No component tests.
- Script: `server/scripts/ask-stream-test.js` (needs ASK_COOKIE and --yes).
- `DECISIONS.md` has D-001 to D-066.

## What is broken or unverified

- 9A manual checks (local curl, then Render) pending until you run them.
- Groq streaming details are assumptions, not verified live: delta.content vs delta.reasoning, usage location (usage or x_groq.usage), mid-stream error shape, [DONE] terminator. Mocked tests do not prove them.
- Reasoning tokens may eat max_completion_tokens and produce empty answers (BAD_RESPONSE); unconfirmed.
- Proxy buffering on Render for SSE is unchecked (verify tokens arrive progressively on the live URL).
- Client has no streaming yet (9B); it still uses the non-streaming ask.
- Client does not read Retry-After, so rate-limit messages say "about a minute" (D-055, D-059).
- Active repos show a Delete button that always ends in the server's 409 (D-056).
- A network failure during the first /api/me looks like signed out (D-051). The waking banner shows for any non-poll request slower than 4 s (D-052).
- Server: SEARCH_MIN_SCORE 0.5 is a placeholder; follow-ups retrieve on the raw question (Phase 11); no rate limiting until Phase 12, so do not share the link widely.
- A chip proves a citation number exists, not that the claim is supported (D-058).
- Still unmeasured: embedding batch limit, Cloudflare reset time, vector index storage, 512 token truncation, GitHub download accounting, NUM_CANDIDATES and chunking defaults (Phase 10).

## Files added or changed (Phase 9A)

- Added: `server/test/llm.stream.test.js`, `server/test/ask.stream.routes.test.js`, `server/scripts/ask-stream-test.js`
- Changed: `server/src/services/llm.js` (appended), `server/src/services/answer.js` (import, appended), `server/src/routes/repos.js` (import, toStreamError, new route), `DECISIONS.md` (D-060 to D-066), `STATUS.md`

## Next

**Phase 9B:** client stream reader with fetch (POST), progressive answer rendering, Stop button (AbortController), loading and error states, citation chips after `done`, plus the Phase 9 Explain-back questions.
