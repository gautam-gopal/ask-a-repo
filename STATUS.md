# Status

## Current phase

Phase 8 complete (8A shell and auth, 8B repos page, 8C chat page). Next: Phase 9, streaming answers.

## What works

- Live at https://ask-a-repo.onrender.com (Render free, auto-deploy from main). Phases 0 to 7: /healthz, auth, GitHub client, chunker (50 / 10 / 1500), embeddings (Cloudflare Workers AI, 768 dims), Chunk model, Atlas vector index `chunks_vector`, ingest pipeline, repo routes, retrieval and search, Groq answers (gpt-oss-120b, fallback gpt-oss-20b), `POST /api/repos/:id/ask`, `GET /api/repos/:id/messages`.
- Phase 8A: app shell, API client, auth pages, routing, plain CSS, waking banner.
- Phase 8B: repos page (list, add, polling, delete with confirm).
- Phase 8C (client only, server unchanged): `ChatPage` at /repos/:id. Loads repo and history, redirects to /repos with a notice if missing or not ready. Enter sends, Shift+Enter adds a newline, counter against 500, Send disabled while pending, auto-scroll, focus returns to the input after a reply, aria-live announcement of new answers, back link, page titles on all pages. `chatHelpers.js` (linkifyCitations, orderSources, isGithubUrl, formatAskError) tested from `server/test/chatHelpers.test.js`. Answers are plain text; [n] and 【n】 become citation chips that scroll to and highlight the source; sources are listed cited-first and link only if the URL starts with https://github.com/ (new tab, noopener noreferrer). Not-found state, fallback-model note, mapped error messages that keep the typed question.
- Tests: `npm --prefix server test` (no network). No component tests.
- `DECISIONS.md` has D-001 to D-059.

## What is broken or unverified

- 8C manual checks (local and Render) pending until you run them.
- Client does not read Retry-After, so rate-limit messages say "about a minute" (D-055, D-059).
- Active repos show a Delete button that always ends in the server's 409 (D-056).
- A network failure during the first /api/me looks like signed out (D-051). The waking banner shows for any non-poll request slower than 4 s (D-052).
- Server: SEARCH_MIN_SCORE 0.5 is a placeholder; follow-ups retrieve on the raw question (Phase 11); reasoning tokens may empty answers (unconfirmed); no rate limiting until Phase 12, so do not share the link widely; no streaming yet.
- A chip proves a citation number exists, not that the claim is supported (D-058).
- Still unmeasured: embedding batch limit, Cloudflare reset time, vector index storage, 512 token truncation, GitHub download accounting, NUM_CANDIDATES and chunking defaults (Phase 10).

## Files added or changed (Phase 8C)

- Added: `client/src/chatHelpers.js`, `server/test/chatHelpers.test.js`
- Changed: `client/src/pages/ChatPage.jsx` (replaced), `client/src/components.jsx` (useTitle), `client/src/pages/ReposPage.jsx` (title, notice), `client/src/pages/LoginPage.jsx` (title), `client/src/styles.css` (appended), `DECISIONS.md` (D-057 to D-059), `STATUS.md`

## Next

**Phase 9:** SSE ask endpoint (sources, token, done events), abort the Groq request on client disconnect, client reads the stream with fetch.
