# Status

## Current phase

Phase 9 complete (9A server streaming, 9B client streaming). Next: Phase 10, the evaluation harness.

## What works

- Live at https://ask-a-repo.onrender.com (Render free, auto-deploy from main). Phases 0 to 9: /healthz, auth, GitHub client, chunker (50 / 10 / 1500), embeddings (Cloudflare Workers AI, 768 dims), Chunk model, Atlas vector index `chunks_vector`, ingest pipeline, repo routes, retrieval and search, Groq answers (gpt-oss-120b, fallback gpt-oss-20b), `POST /api/repos/:id/ask`, `POST /api/repos/:id/ask/stream` (SSE), `GET /api/repos/:id/messages`, React client (auth, repos page, streaming chat page).
- Phase 9B (client only): `parseSseStream` (sse.js), `askStream` (api.js), Chat page streams tokens with rAF batching, Stop button, partial text kept on stop or error, question restored, scroll pinning, aria-live on start and completion only. The non-streaming ask stays in api.js and the server as a fallback and for tests.
- Tests: `npm --prefix server test` (no network). New: sse.test.js, askStream.test.js. No component tests.
- `DECISIONS.md` has D-001 to D-072.

## What is broken or unverified

- 9A and 9B manual checks (local, then Render) pending until you run them.
- Groq streaming details are assumptions, not verified live: delta.content vs delta.reasoning, usage location, mid-stream error shape, [DONE], and the reasoning params (D-067). Run groq-stream-probe.js.
- Reasoning tokens may eat max_completion_tokens and give empty answers (BAD_RESPONSE); unconfirmed.
- Proxy buffering on Render for SSE is unchecked.
- Graceful shutdown (SIGTERM/SIGINT) waits for open SSE connections, so a deploy or Ctrl+C can hang until streams end. Not fixed.
- A "[1]" inside an unclosed code fence can briefly render as a chip mid-stream (D-069).
- Client does not read Retry-After, so rate-limit messages say "about a minute" (D-055, D-059).
- Active repos show a Delete button that always ends in the server's 409 (D-056).
- A network failure during the first /api/me looks like signed out (D-051). The waking banner shows for any non-poll request slower than 4 s (D-052).
- Server: SEARCH_MIN_SCORE 0.5 is a placeholder; follow-ups retrieve on the raw question (Phase 11); no rate limiting until Phase 12, so do not share the link widely.
- A chip proves a citation number exists, not that the claim is supported (D-058).
- Still unmeasured: embedding batch limit, Cloudflare reset time, vector index storage, 512 token truncation, GitHub download accounting, NUM_CANDIDATES and chunking defaults (Phase 10).

## Files added or changed (Phase 9B)

- Added: `client/src/sse.js`, `server/test/sse.test.js`, `server/test/askStream.test.js`
- Changed: `client/src/api.js` (import, appended askStream), `client/src/chatHelpers.js` (STREAM_INTERRUPTED message), `server/test/chatHelpers.test.js` (one case), `client/src/pages/ChatPage.jsx` (rewritten), `DECISIONS.md` (D-068 to D-072), `STATUS.md`

## Next

**Phase 10:** `eval/questions.json` (15 to 20 labelled questions over NexTalk and one small repo), `scripts/eval.js` (hit@5, MRR, results.md), chunk-size, overlap and path-prefix experiments, and SEARCH_MIN_SCORE calibration.
