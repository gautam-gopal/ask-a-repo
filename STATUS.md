# Status

## Current phase

Phase 1 complete (auth backend and tests). Next: Phase 2 (GitHub client).

## What works

- Live at https://ask-a-repo.onrender.com (Render free, auto-deploy from main). Phase 0 items unchanged: /healthz, React shell, env validation, Atlas M0.
- POST /api/auth/signup (201, sets cookie), POST /api/auth/login (200, sets cookie), POST /api/auth/logout (clears cookie), GET /api/me (protected).
- bcryptjs (cost 10), password min 8 chars / max 72 bytes. passwordHash is select:false and stripped in toJSON.
- JWT HS256, 7 days, in httpOnly + SameSite=Lax cookie (Secure in production only). Logout clears it with the same options.
- zod validate middleware; email trimmed and lowercased; unique email index (awaited at boot via User.init()).
- Central error handler with { error: { code, message } }: 400 validation / invalid JSON, 401 auth, 409 duplicate email, 404 unknown route, 500 generic (no stack traces sent).
- Login returns the same 401 for unknown email and wrong password, with a dummy-hash compare to even out timing.
- SPA fallback does not shadow /api; unknown /api paths return JSON 404.
- Tests: `npm --prefix server test` runs 18 Vitest + supertest tests (auth middleware: no cookie, garbage token, wrong secret, expired, deleted user, valid; routes: signup, login, logout, duplicate, validation). User model is replaced by an in-memory fake, so no Atlas needed.

## What is broken

- Nothing known. Secure cookie over HTTPS on Render not yet verified by hand.
- Tests use a fake User model: they do not prove the real unique index or select:false behaviour.
- No CI yet (Phase 12). No rate limiting (Phase 12). No refresh tokens (known limitation).
- DECISIONS.md has no auth entries yet (cookie vs localStorage, no refresh token, cost 10).

## Files added or changed

- Added: server/vitest.config.js, server/test/{setup,fakeUser,app}.js, server/test/auth.middleware.test.js, server/test/auth.routes.test.js
- Changed: server/package.json (test script, devDependencies vitest and supertest), server/package-lock.json

## Next

Phase 2: services/github.js (strict URL parsing, default branch and commit SHA, tree fetch, filters and caps, typed errors) with URL-parsing unit tests.
