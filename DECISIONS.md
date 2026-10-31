# Decisions

## D-001: Fail-fast config validation

- Context: a missing or malformed env var otherwise fails mysteriously on first use.
- Options considered: read process.env directly; validate everything at boot.
- Decision: zod schema in config.js; the process exits at boot naming the variable and the reason, never its value.
- Why: a crash at boot is obvious; a failure on the first login is not.
- What would change this: many optional features that need lazy config.

## D-002: Atlas network access open to 0.0.0.0/0

- Context: Render free has no fixed outbound IP, so an IP allowlist is impossible.
- Options considered: IP allowlist; allow all IPs; a plan with fixed outbound IPs or private networking.
- Decision: allow all IPs.
- Why: the only zero-cost option that works.
- Mitigations: long generated password, DB user limited to readWrite on the askarepo database only, TLS enforced by Atlas.
- What would change this: a hosting plan with fixed outbound IPs or private networking.

## D-003: Auth token in an httpOnly cookie, not localStorage

- Context: the browser must stay signed in across requests.
- Options considered: JWT in localStorage sent as an Authorization header; JWT in an httpOnly cookie.
- Decision: httpOnly cookie with SameSite=Lax, Secure in production, Path=/, Max-Age of 7 days.
- Why: page JavaScript cannot read an httpOnly cookie, so an XSS bug cannot steal the token. The app is deployed same-origin (Express serves the React build), so there is no CORS or credentials configuration.
- Trade-off: browsers attach cookies automatically, which is the CSRF risk. SameSite=Lax stops the cookie being sent on cross-site POSTs, which covers our state-changing routes today.
- What would change this: a separate frontend domain or a mobile client, which would need CSRF tokens or SameSite=None plus extra protection.

## D-004: Same 401 for unknown email and wrong password

- Context: login errors can reveal which emails have accounts.
- Options considered: specific messages for each case; one generic message.
- Decision: one 401 and one message for both cases, plus a dummy bcrypt compare when the email does not exist so response times are similar.
- Why: prevents account enumeration through both the message and the timing.
- Trade-off: signup still reveals existing emails through the 409 EMAIL_TAKEN response, so enumeration through signup remains. Accepted for now; Phase 12 rate limiting reduces bulk abuse.
- What would change this: an email-verification flow that responds identically either way.

## D-005: bcryptjs, cost 10, passwords of 8 to 72 bytes

- Context: passwords need hashing that builds on a free host without native compilation.
- Options considered: native bcrypt; argon2; bcryptjs.
- Decision: bcryptjs with cost 10. Passwords are limited to 8 to 72 bytes.
- Why: pure JavaScript, so no build problems on Render. 72 bytes is bcrypt's input limit, and longer passwords would be silently truncated.
- Trade-off: slower than native bcrypt, and argon2 is the newer recommendation.
- What would change this: a host with more CPU, or a security review that asks for argon2.

## D-006: Stateless 7-day JWT, no refresh tokens

- Context: sessions need an expiry and a way to end.
- Options considered: server-side sessions stored in Mongo; short-lived access token plus refresh token; a single long-lived JWT.
- Decision: one HS256 JWT, 7-day expiry, containing only the user id (sub), iat and exp.
- Why: the smallest surface and the least code, with no session store.
- Trade-off: logout only clears the cookie. A stolen token stays valid until it expires, up to 7 days, and revoking it would need a denylist or a token-version field on the user.
- Verified live: logout clears the cookie, and /api/me returns 401 afterwards.
- What would change this: a need for server-side revocation, or a shorter expiry with refresh tokens.

## D-007: One JSON error shape from a central handler

- Context: the client needs predictable errors, and the server must not leak internals.
- Decision: every error returns { error: { code, message } } with the right status (400 validation, 401 auth, 409 duplicate email). No stack traces in responses.
- Why: the client handles one shape, and stack traces would expose file paths and library details.
- Trade-off: every new error type has to be mapped as features are added.

## D-008: Auth tests use an in-memory fake User model

- Context: unit tests should be fast, free and independent of Atlas.
- Options considered: a real test database; mongodb-memory-server; a fake model.
- Decision: 18 Vitest and supertest tests against a fake User model.
- Limit: the fake does not prove the real unique index, select: false on passwordHash, or production cookie behavior.
- Compensation: a manual check on the live deploy. Signup returned 201 with a Secure cookie, a duplicate signup returned 409, /api/me returned 200 with the cookie, logout cleared it, and /api/me then returned 401.
- What would change this: logic that depends on real queries (for example vector search) needs integration tests against a throwaway database.

## D-009: Rate limiting deferred to Phase 12

- Context: login and signup are brute-force and abuse targets.
- Decision: no rate limiting yet. Phase 12 adds per-IP limits on auth routes and per-user limits elsewhere.
- Why: keeps each phase small and finishable.
- Risk: until then the endpoints can be hammered. Acceptable while there are no real users, but do not share the link widely before Phase 12.
