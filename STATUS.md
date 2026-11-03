# Status

## Current phase

Phase 8B complete (repos page: list, add, polling, delete). Next: 8C, chat view.

## What works

- Live at https://ask-a-repo.onrender.com (Render free, auto-deploy from main). Phases 0 to 7: /healthz, auth, GitHub client, chunker (50 / 10 / 1500), embeddings (Cloudflare Workers AI, 768 dims), Chunk model, Atlas vector index `chunks_vector`, ingest pipeline, repo routes, retrieval and search, Groq answer generation (gpt-oss-120b with gpt-oss-20b fallback), `POST /api/repos/:id/ask`, `GET /api/repos/:id/messages`.
- Phase 8A: app shell, API client, auth pages, routing, plain CSS.
- Phase 8B (client only, server unchanged): `ReposPage` with the repo list (owner/name, status badge, created time, file and chunk counts when ready), an add-repository form with server error codes mapped to readable messages, a limits note, progress bar for queued and indexing, failed repos with the stored error and a Remove button, ready repos with Open (/repos/:id) and Delete with an inline confirm, per-row delete errors (including the server's 409), empty and loading states. Polling GET /api/repos every 3 s only while a repo is queued or indexing; stops when none are active, when the tab is hidden (resumes on return) and on unmount; one request at a time; backoff 3 s doubling to 30 s on errors. `repoHelpers.js` (statusLabel, isActive, progressPercent, formatError, formatCreated) tested from `server/test/repoHelpers.test.js`.
- Tests: `npm --prefix server test` (no network) includes the helper tests. No component tests.
- `DECISIONS.md` has D-001 to D-056.

## What is broken or unverified

- 8B manual checks (Verify list) and a deploy check on Render are pending until you run them.
- Client does not read Retry-After, so BUSY says "about a minute" (D-055).
- Active repos show a Delete button that always ends in the server's 409 (D-056).
- A network failure during the first /api/me looks like signed out (D-051). The waking banner shows for any non-poll request slower than 4 s (D-052).
- Server: live ask check on Render pending; SEARCH_MIN_SCORE 0.5 is a placeholder; follow-ups retrieve on the raw question (Phase 11); reasoning tokens may empty answers (unconfirmed); no rate limiting until Phase 12, so do not share the link widely; no streaming (Phase 9).
- Still unmeasured: embedding batch limit, Cloudflare reset time, vector index storage, 512 token truncation, GitHub download accounting, NUM_CANDIDATES and chunking defaults (Phase 10).

## Files added or changed (Phase 8B)

- Added: `client/src/repoHelpers.js`, `server/test/repoHelpers.test.js`
- Changed: `client/src/pages/ReposPage.jsx` (replaced), `client/src/api.js` (listRepos option), `client/src/styles.css` (appended), `DECISIONS.md` (D-054 to D-056), `STATUS.md`

## Next

**8C:** chat view on /ask and /messages, citation links, loading, error and not-found states, mobile check, deploy check.
