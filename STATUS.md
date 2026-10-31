# Status

## Current phase

Phase 0 complete. Next: Phase 1 (authentication).

## What works

- Live at https://ask-a-repo.onrender.com (Render free, auto-deploy from main).
- GET /healthz returns 200 with db: connected.
- Express serves the built React shell from client/dist and falls back to index.html for non-API GET routes; the shell shows live health status.
- Env validation at boot (zod) for NODE_ENV, PORT, MONGODB_URI, JWT_SECRET; Atlas M0 connected (db: askarepo); network access 0.0.0.0/0 (DECISIONS.md D-002).
- Render env: NODE_VERSION=22, NODE_ENV=production, MONGODB_URI, JWT_SECRET. PORT is injected by Render.

## What is broken

- Nothing known. Known limitation: the first request after 15 idle minutes takes about a minute, and the UI cannot show a waking message on that first load.
- No custom error handler yet (Phase 1).

## Files added or changed

- package.json (root), .gitignore, .env.example
- server/package.json, server/package-lock.json, server/src/config.js, server/src/index.js
- client/package.json, client/package-lock.json, client/vite.config.js, client/index.html, client/src/main.jsx, client/src/App.jsx, client/src/styles.css
- Removed the stray ask-a-repo self-dependency from both package.json files.
- DECISIONS.md: D-001, D-002

## Next

Phase 1: signup, login, logout, GET /api/me, bcryptjs, JWT in httpOnly cookie, zod, central error handler, auth middleware tests.
