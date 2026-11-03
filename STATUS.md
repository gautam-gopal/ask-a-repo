# Status

## Current phase

Phase 8A complete (app shell, API client, auth pages, routing). Next: 8B, repo list, add repo, polling, delete.

## What works

- Live at https://ask-a-repo.onrender.com (Render free, auto-deploy from main). Phases 0 to 7: /healthz, auth, GitHub client, chunker (50 / 10 / 1500), embeddings (Cloudflare Workers AI, 768 dims), Chunk model, Atlas vector index `chunks_vector`, ingest pipeline, repo routes, retrieval and search, Groq answer generation (gpt-oss-120b with gpt-oss-20b fallback), `POST /api/repos/:id/ask`, `GET /api/repos/:id/messages`.
- Phase 8A (client only, server unchanged): `client/src/api.js` (fetch wrapper, ApiError, 4 s waking hook, 75 s timeout, 401 handler, repo and ask functions ready for 8B/8C), `auth.jsx` (AuthProvider, /api/me as source of truth), `components.jsx` (Spinner, ErrorMessage, WakingBanner, Layout), `pages/LoginPage.jsx` (login and signup toggle, client validation matching the server), placeholder `ReposPage` and `ChatPage`, routing in `App.jsx` (/login, protected /repos and /repos/:id, catch-all to /repos), plain CSS with variables in `styles.css`.
- Express SPA fallback serves index.html for /login, /repos and /repos/:id and never shadows /api.
- Tests: server suite unchanged (`npm --prefix server test`, no network). No client tests.
- `DECISIONS.md` has D-001 to D-053.

## What is broken or unverified

- 8A manual checks (Verify list) and a deploy check on Render are pending until you run them.
- A network failure during the first /api/me looks like signed out (D-051).
- The waking banner also shows for any non-ask request slower than 4 s (D-052).
- Server: live ask check on Render pending; SEARCH_MIN_SCORE 0.5 is a placeholder; follow-ups retrieve on the raw question (Phase 11); reasoning tokens may empty answers (unconfirmed); no rate limiting until Phase 12, so do not share the link widely; no streaming (Phase 9).
- Still unmeasured: embedding batch limit, Cloudflare reset time, vector index storage, 512 token truncation, GitHub download accounting, NUM_CANDIDATES and chunking defaults (Phase 10).

## Files added or changed (Phase 8A)

- Added: `client/src/api.js`, `auth.jsx`, `components.jsx`, `pages/LoginPage.jsx`, `pages/ReposPage.jsx`, `pages/ChatPage.jsx`
- Changed: `client/src/App.jsx`, `main.jsx`, `styles.css`, `client/vite.config.js` (comment), `client/package.json` and lockfile (react-router-dom), `DECISIONS.md` (D-050 to D-053), `STATUS.md`

## Next

**8B:** repo list with status badges, add-repo form, polling of GET /api/repos/:id until ready or failed, delete, re-index (delete a failed repo, then add again), empty, loading and error states.
**8C:** chat view on /ask and /messages, citation links, states, mobile check, deploy check.
