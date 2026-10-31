# Status

## Current phase

Phase 0, part 0A (server skeleton): complete once Verify passes.

## What works

- Express server in server/ with GET /healthz returning 200 and DB state.
- Env validation at boot (zod) for NODE_ENV, PORT, MONGODB_URI, JWT_SECRET; exits with a readable message on failure.
- Mongoose connection to Atlas M0 (db: askarepo); server listens only after the connection succeeds.
- Atlas: M0 cluster, DB user with readWrite on askarepo, network access 0.0.0.0/0 (see DECISIONS.md D-002).

## What is broken

- Nothing known. Not deployed yet; no client yet.

## Files added or changed

- server/package.json, server/package-lock.json
- server/src/config.js, server/src/index.js
- .env.example (added NODE_ENV, comments)
- DECISIONS.md (D-001, D-002)

## Next

0B: Vite React client skeleton, Express serving client/dist, root build and start scripts.
