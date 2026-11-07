# Protections and known limitations

Protection values below reflect the current implementation and configuration.

## Rate limits (`server/src/middleware/rateLimit.js`)

| Limit                   | Value          | Keyed by | Notes                                                            |
| ----------------------- | -------------- | -------- | ---------------------------------------------------------------- |
| Signup                  | 5 per hour     | IP       | All attempts count                                               |
| Login                   | 10 per 15 min  | IP       | Failed attempts only                                             |
| Ask, ask/stream, search | 20 per 10 min  | User     | One shared counter                                               |
| Ask, ask/stream, search | 60 per 10 min  | IP       | Backstop across accounts                                         |
| Add repository          | 5 per day      | User     |                                                                  |
| Add repository          | 10 per day     | IP       |                                                                  |
| General                 | 300 per 15 min | IP       | GET /api/repos\* skipped because the client polls while indexing |

All return HTTP 429 `TOO_MANY_REQUESTS`, with `Retry-After` and `RateLimit-*` headers.

`TRUST_PROXY=1` is the default. The Render client-IP check passed.

Rate-limit counters use an in-memory store. See known limitations below.

## Caps and budgets

| Protection                     | Value                                                       | Where                             |
| ------------------------------ | ----------------------------------------------------------- | --------------------------------- |
| Repositories per user          | 3                                                           | `ingest.js`, `MAX_REPOS_PER_USER` |
| Active ingests per user        | 1                                                           | `ingest.js`                       |
| Concurrent ingests per process | 2, then 503 BUSY                                            | `ingest.js`                       |
| Ingest timeout                 | 10 min                                                      | `ingest.js`                       |
| Files per repository           | 150                                                         | `github.js`                       |
| Maximum bytes per file         | 200 KB                                                      | `github.js`                       |
| Maximum bytes per repository   | 2 MB                                                        | `github.js`                       |
| Characters per chunk           | 1500                                                        | `chunker.js`                      |
| Chunks per repository          | No explicit cap; indirectly bounded by file and byte limits |                                   |
| Accounts                       | 200, then 503 SIGNUPS_CLOSED                                | `signupCap.js`, `MAX_USERS`       |
| Daily embedding budget         | 8000 estimated neurons (UTC day)                            | `usage.js`                        |
| Daily LLM budget               | 500 requests (UTC day)                                      | `usage.js`                        |
| Question length                | 500 characters                                              | `routes/repos.js`                 |
| Repository URL length          | 200 characters                                              | `routes/repos.js`                 |
| JSON body                      | 16 KB, HTTP 413 beyond                                      | `app.js`                          |
| Output tokens per answer       | 1500                                                        | `llm.js`                          |
| Excerpt budget in prompt       | 3000 estimated tokens                                       | `prompt.js`                       |

The Groq organization limits shown for both configured models are 1000 requests/day and 200K tokens/day per model. The application budget of 500 counts requests across both models; it does not enforce their separate token quotas.

Daily usage budgets are estimates, not exact provider billing measurements.

## Expiry

| Data                                             | TTL    |
| ------------------------------------------------ | ------ |
| Non-demo repositories, their chunks and messages | 7 days |
| Demo repositories                                | No TTL |
| Usage documents                                  | 7 days |

Repository, chunk and message expiry uses `expiresAt` with MongoDB TTL indexes.

## Authentication and access control

| Protection     | Detail                                                                                 |
| -------------- | -------------------------------------------------------------------------------------- |
| Passwords      | bcryptjs cost 10; 8 to 72 bytes; dummy-hash comparison for unknown email               |
| Session        | HS256 JWT, 7 days, payload contains user ID only; algorithm pinned on verification     |
| Cookie         | HttpOnly, SameSite=Lax, Path=/, Secure in production, max-age 7 days                   |
| Login errors   | Same 401 for unknown email and wrong password                                          |
| Ownership      | Repository queries filter by both `_id` and `userId`                                   |
| Messages       | Queries also filter by `userId`                                                        |
| Retrieval      | Ownership and ready status checked before `$vectorSearch`; vector filter uses `repoId` |
| Test exclusion | New ingestions skip test and spec files by default (`INDEX_EXCLUDE_TESTS=true`)        |

## Input and output handling

| Protection       | Detail                                                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Validation       | Zod on signup, login, add repository, ask and search; repository IDs must match 24 hexadecimal characters                    |
| Repository URL   | Only GitHub HTTPS repository URLs are accepted                                                                               |
| Network access   | GitHub API is used for repository fetching                                                                                   |
| Security headers | Helmet; CSP uses same-origin scripts and styles, without `unsafe-inline`; `frame-ancestors 'none'`                           |
| Errors           | Consistent JSON error shape; unknown errors become generic HTTP 500 responses                                                |
| Prompt injection | Excerpts and history are delimited and treated as untrusted data; the model has no tools                                     |
| Rendering        | Model output is rendered as plain text; only GitHub URLs become links; citations are validated against supplied excerpts     |
| Logging          | JSON request logs include request ID, method, route, status, duration and user ID. Sensitive request contents are not logged |
| Error redaction  | `redact()` removes configured secrets, connection strings, bearer tokens and email addresses from supported error logs       |

The production browser check found no visible CSP violations during login, repository navigation and a streamed answer.

## CI

GitHub Actions runs on pushes and pull requests targeting `main`.

- Node.js 22
- `npm ci` for server and client
- Server tests
- Client tests when a test script exists
- Client production build

No production secrets or database connection are required by the CI workflow.

## Known limitations

- Rate-limit counters, active-ingest tracking and concurrency limits are in-memory. They reset on restart and are not shared across multiple instances.
- No refresh tokens or token revocation. A stolen JWT can remain valid for up to 7 days.
- No CSRF token; cookie protection relies on SameSite=Lax.
- Signup reveals existing email addresses through HTTP 409 EMAIL_TAKEN.
- One shared GitHub token and one shared Cloudflare token serve all users.
- Daily budgets are estimates. The LLM budget tracks requests, not tokens.
- Render free-tier cold starts can take about a minute after inactivity.
- Ingest jobs do not resume after a process restart; interrupted jobs are marked failed.
- In-memory limits are suitable for the current single-instance deployment, not horizontally scaled deployment.
- Repositories indexed before test exclusion was introduced retain their old test chunks until re-ingested.
- `/healthz` is public and reports database state and uptime.
