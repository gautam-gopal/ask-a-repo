# Status

## Current phase

Phase 0: parts 0A and 0B complete. 0C (deploy) not started.

## What works

- Express server in server/ with GET /healthz returning 200 and DB state.
- Env validation at boot (zod) for NODE_ENV, PORT, MONGODB_URI, JWT_SECRET; exits with a readable message on failure.
- Mongoose connection to Atlas M0 (db: askarepo); server listens only after the connection succeeds.
- Atlas: M0 cluster, DB user with readWrite on askarepo, network access 0.0.0.0/0 (see DECISIONS.md D-002).
- Vite + React client in client/ (plain CSS); the page fetches /healthz and shows the result.
- Express serves client/dist and falls back to index.html for non-API GET routes; /healthz and /api/\* are not shadowed.
- Root scripts: build (installs both sides with dev deps, builds client), start, dev (server), dev:client (Vite with proxy to :3000).

## What is broken

- Nothing known. Not deployed yet.
- No custom error handler yet (Phase 1); Express default is in effect.

## Files added or changed

- package.json (root)
- client/package.json, client/package-lock.json, client/vite.config.js, client/index.html
- client/src/main.jsx, client/src/App.jsx, client/src/styles.css
- server/src/index.js (static serving + SPA fallback)

## Next

0C: deploy to Render. Build command: npm run build. Start command: npm start. Set NODE_ENV, MONGODB_URI, JWT_SECRET in Render env vars. Confirm the live URL serves the shell and /healthz returns 200 with db status.
