# Status

## Current phase

Phase 1A complete (auth backend). Next: 1B (tests and Explain-back).

## What works

- Live at https://ask-a-repo.onrender.com (Render free, auto-deploy from main). Phase 0 items unchanged: /healthz, React shell, env validation, Atlas M0.
- POST /api/auth/signup (201, sets cookie), POST /api/auth/login (200, sets cookie), POST /api/auth/logout (clears cookie), GET /api/me (protected).
- bcryptjs (cost 10), password min 8 chars / max 72 bytes. passwordHash is select:false and stripped in toJSON.
- JWT HS256, 7 days, in httpOnly + SameSite=Lax cookie (Secure in production only). Logout clears it with the same options.
- zod validate middleware; email trimmed and lowercased; unique email index (awaited at boot via User.init()).
- Central error handler with { error: { code, message } }: 400 validation / invalid JSON, 401 auth, 409 duplicate email, 404 unknown route, 500 generic (no stack traces sent).
- Login returns the same 401 for unknown email and wrong password, with a dummy-hash compare to even out timing.
- SPA fallback does not shadow /api; unknown /api paths return JSON 404.

## What is broken

- Nothing known. Not yet verified on the Render deployment (Secure cookie over HTTPS). Check after pushing.
- No automated tests yet (1B). No rate limiting (Phase 12). No refresh tokens (known limitation).

## Files added or changed

- Added: server/src/models/User.js, server/src/middleware/{errors,validate,auth}.js, server/src/routes/auth.js
- Changed: server/src/index.js (json, cookie-parser, route mounts, notFound + errorHandler, User.init), server/package.json and package-lock.json (bcryptjs, jsonwebtoken, cookie-parser)

## Next

Phase 1B: auth middleware tests (Vitest + supertest), Explain-back (cookie flags, why not localStorage, CSRF/SameSite), DECISIONS.md entries.
