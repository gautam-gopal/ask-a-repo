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

## D-010: Strict regex on the raw URL, not new URL()

- Context: users supply a URL and the server then calls GitHub, so a loose parser could let a request go to another host.
- Options considered: parse with new URL() and check the hostname; one strict regex on the raw string.
- Decision: only https://github.com/{owner}/{repo} (optional trailing slash or .git) is accepted. Other hosts, http, extra path segments, queries, fragments, userinfo and ports are rejected before anything else happens.
- Why: the rule is a single readable pattern, so the set of accepted inputs is easy to audit, and the server can only ever call api.github.com.
- What would change this: needing to accept other URL forms (for example /tree/branch links).

## D-011: Pin everything to one commit SHA, one recursive tree call

- Context: the repo can change after indexing, and line-number citations must stay valid.
- Decision: resolve the default branch to its latest commit SHA, fetch the whole tree with one recursive Git Trees call, and download every file at that SHA. A truncated tree is an error, not a partial index.
- Why: citations link to blob URLs at the SHA, so they stay correct forever. One tree call means filtering and size checks need no downloads.
- What would change this: repos too large for one tree response (they fail with TREE_TRUNCATED today).

## D-012: Hard caps, skip large files, fail loudly on oversize repos

- Context: free tiers limit storage, embedding quota and request time.
- Decision: MAX_FILES 150, MAX_FILE_BYTES 200 KB, MAX_TOTAL_BYTES 2 MB. A single oversize file is skipped and reported. Too many files or bytes throws REPO_TOO_LARGE with the counts. Nothing is truncated silently.
- Why: a skipped generated file should not block a whole repo, but quietly indexing half a repo would give wrong answers with no warning.
- What would change this: a paid tier, or evidence from the eval that the caps drop useful files.

## D-013: Contents API (raw media type) for file downloads, shared server token

- Context: file contents must be fetched at a pinned SHA.
- Decision: one Contents API request per file with the raw media type, using a read-only fine-grained token for public repos. Each download is checked: byte length must match the tree size, content must be strict UTF-8, and a NUL byte means binary.
- Risk: one token serves every user, so all ingests share one hourly request budget. Cost per ingest is measured with the Requests used line from list-repo.js --fetch. Phase 12 per-user limits protect it.
- What would change this: measured costs showing the budget is too tight, which would mean switching download route or adding caching.

## D-014: Retry only transient failures

- Context: free-tier networks and GitHub drop requests occasionally.
- Decision: 5 concurrent downloads, 10 second timeout, up to 2 retries with jittered backoff on network errors and 5xx. 404 and rate limits fail immediately and stop the other workers.
- Why: retrying a 404 or a rate limit only wastes budget and delays the error message.
- Known gap: a 404 on one file reports the generic "not found, or private" message.

## D-015: Line-based windows with overlap

- Context: citations need file and line ranges, and retrieval quality is capped by chunk quality.
- Options considered: fixed character slices; line windows with overlap; AST or function-level chunks.
- Decision: windows of N lines with M lines of overlap (step = N - M). Line numbers are 1-based and inclusive, and a chunk's text is exactly its source lines joined with LF. CRLF and CR are normalised first.
- Why: code is line-oriented, character cuts split mid-line and lose the line mapping, and overlap keeps a function split across a boundary retrievable.
- Trade-off: windows ignore syntax, so a chunk can start or end mid-function. Blank-only chunks are skipped.
- What would change this: Phase 10 eval showing function-aware chunks retrieve better (stretch: AST chunking for JavaScript).

## D-016: File path inside the embedded text

- Context: a question like "where is auth handled" should match a file named auth.js even if its code never says "auth".
- Decision: each chunk stores `text` (raw, shown to users and sent to the LLM) and `embedText` = "File: <path>" + LF + text (sent to the embedding model only).
- Why: the path is real signal for the embedding, while the stored text stays exact for display and line citations.
- What would change this: the Phase 10 with-and-without-path experiment showing no gain.

## D-017: Character cap per chunk, long lines split into segments

- Context: minified or generated lines can make 50 lines enormous, which breaks the embedding input limit.
- Decision: maxChunkChars 1500. A window is shortened at a line boundary until it fits (minimum one line). A single over-long line is split into character segments that all keep that line's number.
- Why: bounded input size without ever cutting a normal line. Citations stay valid because segments point at the right line.
- Trade-off: segments do not overlap each other. If the cap shortens a window so the overlapped next window would add no new line, the overlap is skipped for that boundary. Segments can split a surrogate pair.
- What would change this: embedding model limits differing from the guess, or the eval showing large chunks hurt.

## D-018: Chunking defaults are untuned guesses

- Context: 50 lines, overlap 10 and 1500 characters are provisional settings chosen before retrieval evaluation.
- Decision: keep them until the Phase 10 evaluation. The evaluation will compare windows of 30, 50 and 100 lines, overlaps of 0, 10 and 20, and with versus without the path prefix.
- Why: changing defaults without a baseline is guessing twice.
- Risk: 1500 characters is a conservative estimate, not a guarantee of staying within the embedding model's 512-token input limit. Retrieval quality and chunk-size choices remain unmeasured.

## D-019: Dropped Jina for Cloudflare Workers AI

- Context: the Jina free key was exhausted (balance 0), so embeddings could not run.
- Options considered: top up Jina; Gemini; in-process local model; Cloudflare Workers AI.
- Decision: Cloudflare Workers AI. Free allowance of 10,000 neurons per day, no card.
- Why: zero cost, a REST API (no server RAM or CPU), and the provider sits behind embeddings.js.
- Trade-off: a daily allowance instead of a one-off balance; a 512-token input limit; no query mode.
- What would change this: Cloudflare cutting the free allowance.

## D-020: bge-base-en-v1.5, 768 dimensions, cls pooling, storage maths

- Decision: `@cf/baai/bge-base-en-v1.5`, 768 dims, max 512 tokens, 6058 neurons per million input tokens. The 10,000 neurons/day allowance is about 1.65M tokens, roughly 3,800 to 4,400 chunks a day.
- Storage: MongoDB stores a number array as BSON doubles: 8 bytes per value, plus 1 type byte and an index-string key per element. That is about 9.9 KB per 768-dim vector, plus about 1.3 KB for text and metadata, so about 11.2 KB per chunk. The 512 MB free tier holds roughly 45,000 chunks (indexes and the vector index not included). A max-size repo (2 MB of source) is about 1,500 chunks, about 17 MB.
- Possible later saving: BSON binary float32 vectors (about 3 KB per vector). Check driver and Atlas support in 4B.
- What would change this: the eval favouring another model, or storage pressure.

## D-021: Batch and retry policy

- Decision: batches of 32 (well below the documented per-request item cap, check current docs for the number, so a failed batch wastes little quota), concurrency 2, 20 s timeout, up to 3 retries with jittered exponential backoff on network errors, timeouts, 429 and 5xx. Retry-After is honoured, and a wait over 30 s fails fast.
- Not retried: auth, quota exhausted, bad response, dimension mismatch. Retrying them only burns time.
- Errors carry only the status and numeric Cloudflare codes. Never bodies, messages, the token or the account id.
- What would change this: measured rate-limit behaviour in Phase 5.
- Quota exhaustion is Cloudflare error 3036 (HTTP 429), never retried. HTTP 408 with 3007 or 3008 maps to TIMEOUT and is retried. getUsage().requests counts HTTP attempts, batches counts successes.

## D-022: Provider isolation in embeddings.js

- Decision: only embeddings.js knows about Cloudflare. The rest of the app uses embedDocuments, embedQuery, getUsage and EmbeddingError. Provider-specific codes become EmbeddingError codes inside the file.
- Why: D-019 proved free tiers die. Swapping provider is a one-file change, plus a re-embed if dimensions change.
- Known gap: the 512-token input limit is NOT enforced. The chunker's 1500-char cap and the 1536-char risk threshold are character-based estimates, not token guarantees; dense code can exceed 512 tokens under the cap and silently lose its tail. getUsage().truncationRisk counts inputs over 1536 chars but does not reject or split them. We do not claim every chunk fits. Phase 10 measures whether truncation hurts retrieval.

## D-023: Cosine similarity

- Context: the vector index needs a similarity function, and the score must be usable as a threshold in Phase 7.
- Options considered: cosine, euclidean, dotProduct.
- Decision: cosine.
- Why: BGE models are trained for cosine similarity, which ignores vector length, and Atlas returns it as a bounded score (I believe (1 + cosine) / 2, range 0 to 1; verify in Atlas docs) that can be thresholded.
- Trade-off: BGE scores are compressed into a narrow band, so unrelated text can still score fairly high. The Phase 7 threshold must come from measured scores, not a guess.
- What would change this: the Phase 10 eval favouring a different model or metric.

## D-024: Index name, filter field and test-data design

- Decision: one vector index `chunks_vector` on `chunks.embedding` (768 dims, cosine) with `repoId` declared as a filter field. This uses 1 of 3 free search indexes. Regular index on `repoId`; TTL index on `expiresAt` with expireAfterSeconds 0.
- Why the filter is declared: $vectorSearch can only pre-filter on fields listed as type "filter" in the index. Pre-filtering keeps results to one repo instead of wasting candidates on other users' repos.
- userId is not a filter field: ownership is checked against the repo document in the route (Phase 6), so the index stays minimal.
- numCandidates is 100 in the 4B test script (only 10 documents). Phase 6 will use 10 to 20 times the limit.
- embedding has select:false (about 9.9 KB per chunk) and a length validator against EMBEDDING_DIMENSIONS.
- Test data: scripts/vector-test.js inserts 10 chunks under fixed dummy ids with expiresAt one day ahead, so the TTL removes them even if cleanup is forgotten.
- Open: whether the vector index counts toward the 512 MB, and whether BSON float32 binary vectors work with the current driver. Not measurable on 10 documents; check in Atlas docs before Phase 5 sizing.

## D-025: Background work with a status field, no queue

- Context: indexing takes tens of seconds, longer than a request should stay open.
- Decision: startIngest creates the repo as queued and returns it; runIngest runs unawaited in the same process. The repo's status field is the only job state.
- Why: one instance, so Redis or a queue adds a service for no benefit. Status gives the UI something to poll.
- Trade-off: the job dies with the process (D-027). Concurrency lives in an in-memory Map, so it is wrong with more than one instance.
- What would change this: a second instance, which needs a queue and a worker.

## D-026: State machine and failure cleanup

- Decision: queued -> indexing -> ready | failed. Any error deletes all chunks for the repo, then sets failed with a fixed { code, message } from a lookup table. Provider text is never stored. Unknown errors become INTERNAL and are logged server-side only. runIngest never throws and always releases its slot in finally.
- Why: a half-indexed repo would give wrong answers silently, so partial data is never kept. A final count check (stored chunks must equal chunked chunks) catches silent insert loss.
- Also: if the repo is deleted mid-ingest, the next update matches nothing, so the job deletes its chunks and stops.
- Known gap: the 10 minute limit is checked between stages and batches, not inside a single hung call. Each call has its own timeout, so the overshoot is bounded. The timeout path is not unit tested.

## D-027: Boot-time recovery and its limitation

- Decision: before listening, every repo still queued or indexing is marked failed (INTERRUPTED) and its chunks are deleted. The user adds the repo again.
- Why: with a single instance, nothing can still be working on them.
- Limitation: if Render ever runs two instances briefly (deploy overlap), the new one would fail a job the old one is still running. Jobs are never resumed. Accepted on a free single instance.
- What would change this: a queue with leases or heartbeats.

## D-028: Embed and insert per batch

- Decision: batches of BATCH_SIZE (32): embed, insertMany (ordered: false, throwOnValidationError: true), update progress. Vectors for at most one batch exist in memory (about 300 KB), not the whole repo (about 15 MB).
- Why: bounded memory on 512 MB, live progress for polling, and a failure wastes little quota. Without throwOnValidationError, Mongoose skips invalid docs silently on unordered inserts.
- Usage per ingest comes from the new pure estimateUsage(texts), because getUsage() is process-wide and mixes concurrent ingests. Still an estimate (chars/4).

## D-029: Limits and why these numbers

- MAX_REPOS_PER_USER 3: at the 2 MB cap a repo is about 17 MB (D-020), so 3 is about 51 MB of the 512 MB per user. A few users fit.
- One active ingest per user: stops one user using the shared GitHub and Cloudflare budgets.
- MAX_CONCURRENT_INGESTS 2: Render free has 0.1 CPU, and each ingest already runs 5 GitHub downloads. Excess requests get BUSY, with no queue.
- INGEST_TIMEOUT 10 minutes: a max repo needs about 47 embedding requests, so this is generous.
- Slots are reserved synchronously before any await, so simultaneous requests cannot both pass.
- A max-size repo costs about 3,400 estimated neurons, so roughly 3 per day on the Cloudflare allowance.

## D-030: TTL expiry and indexes

- Decision: every non-demo repo gets expiresAt = createdAt + 7 days (REPO_TTL_MS), and its chunks copy the same value, so both disappear together. Demo repos have no expiresAt (enforced by a pre-validate hook on the model).
- Indexes: unique { userId, ownerLower, nameLower } (names are case-insensitive on GitHub) and TTL on expiresAt. There is no separate userId index because the compound one covers it.
- Limit: the hook runs on create and save only. Any update that sets isDemo must also $unset expiresAt.
- Failed repos expire too, so they do not pile up.

## D-031: 404, not 403, for other users' repos

- Context: a route that takes a repo id must stop user B reading or deleting user A's repo (insecure direct object reference).
- Decision: every lookup is `{ _id, userId: req.user._id }`. Not found and not yours both return the same 404 REPO_NOT_FOUND body.
- Why: a 403 would confirm the id exists. Ids are not secret, so existence should not leak either. The ownership check is part of the query, so there is no code path that loads another user's repo.
- Trade-off: a malformed id gives 400 INVALID_ID, which reveals nothing about existence.
- What would change this: shared or public repos, which need a real 403.

## D-032: 202 plus polling, and the status mapping

- Decision: POST /api/repos returns 202 with the queued repo and does not wait. The client polls GET /api/repos/:id for status, progress and error.
- Why: indexing takes tens of seconds. Polling is stateless and survives a Render cold start. SSE or WebSockets would add connection handling for a status that changes every few seconds.
- Mapping: INVALID_URL 400, REPO_EXISTS, INGEST_IN_PROGRESS and REPO_LIMIT_REACHED 409, BUSY 503 with Retry-After 60. Note: startIngest never throws GithubError, so GitHub failures (not found, private, rate limit) reach the client as status failed with a stored error, not as a POST error. The route maps them anyway as a safety net.
- What would change this: a client needing instant push updates.

## D-033: Delete while indexing is rejected

- Decision: DELETE on a queued or indexing repo returns 409 INGEST_IN_PROGRESS. Failed and ready repos can be deleted.
- Why: runIngest handles a deleted repo (D-026), but cancelling by deletion would also free the user's slot in the database while the job still holds it in memory and keeps spending GitHub and Cloudflare quota until its next update. Rejecting is simpler and has no such gap.
- Order: delete the repo document first, then its chunks. If the second step fails, the orphan chunks expire through the shared TTL. The other order could leave a ready repo with no chunks.
- Limit: no cancel button yet; the user waits for the job to finish or fail.
- What would change this: an AbortController wired through runIngest, which would allow real cancellation.

## D-034: Pre-filter on repoId inside $vectorSearch

- Context: one shared index holds every user's chunks.
- Decision: `filter: { repoId: { $eq: ObjectId } }` inside the `$vectorSearch` stage. repoId is converted to a real ObjectId because aggregate() does not cast.
- Why: the filter applies during the nearest-neighbour search. A $match afterwards would take the top N over all repos, then discard most of them and return few or no results.
- Trade-off: only fields declared as type "filter" in the index work (repoId is, D-024).
- What would change this: filtering on more fields, which means editing the index definition.

## D-035: numCandidates 100, candidate limit 8

- Decision: NUM_CANDIDATES 100 (12.5x the limit, inside PROJECT.md's 10 to 20x), CANDIDATE_LIMIT 8, final DEFAULT_LIMIT 5. All named constants in retrieve.js.
- Why: approximate search examines numCandidates neighbours and returns the best `limit`; more candidates give better recall and more latency. 8 raw hits leave room for merging down to 5.
- Status: untuned guesses. The Phase 10 eval tests them.

## D-036: Merge adjacent hits; long-line rule

- Decision: hits in the same file whose ranges overlap or touch (next.start <= prev.end + 1) become one hit: combined range, max score, text with each line once, mergedFrom count. A merge that would exceed MAX_MERGED_CHARS (4500) is skipped.
- Long-line rule: a hit with startLine === endLine is never merged. Segments of an over-long line share one line number, do not overlap, and carry no offset, so merging by line numbers would drop or misorder text.
- Trade-off: a genuine one-line chunk is not merged with neighbours. Overlap creates near-duplicates, so merging saves prompt space in Phase 7.
- What would change this: storing a segment offset on chunks.

## D-037: Ownership and readiness checked before retrieval

- Decision: the search route loads the repo with { \_id, userId } (404 for missing and not-yours alike, as D-031), then requires status ready (409 REPO_NOT_READY), and only then calls retrieve().
- Why: stops user B searching user A's repo by guessing an id. It also means orphaned chunks of a deleted repo (which live until their TTL) can never be reached, because no repo document means no search.
- Limit: the vector filter uses repoId only. userId is not in the index (D-024), so safety rests on this route check.

## D-038: Retrieval-only route, no score threshold

- Decision: POST /api/repos/:id/search returns merged hits with raw scores, SHA-pinned GitHub URLs and no LLM call. No score threshold.
- Why: separates retrieval from generation so bad answers can be traced to the right stage. BGE scores are compressed (D-023), so a threshold must come from measured data in Phase 10.
- What would change this: Phase 7 reusing retrieve() inside the ask route.

## D-039: Groq models and the fallback policy

- Context: free Groq limits are per-minute and per-day, and the primary model hits them first.
- Decision: GROQ_MODEL (default openai/gpt-oss-120b) first. On RATE_LIMITED or MODEL_UNAVAILABLE, exactly one retry on GROQ_FALLBACK_MODEL (default openai/gpt-oss-20b), reported as usedFallback. Never fall back on AUTH_FAILED (same key, would fail again) or on 5xx/timeout.
- Migration: the original defaults llama-3.3-70b-versatile and llama-3.1-8b-instant were retired by Groq on 2026-08-16 for free and developer tiers. Groq's deprecations page recommends gpt-oss-120b and gpt-oss-20b as replacements. The old IDs came from the zod defaults in config.js, not from .env.
- Request: the body uses max_completion_tokens, because Groq's API reference marks max_tokens deprecated.
- Retry: 2 retries with jittered backoff on network errors and 5xx only. 429 is not retried on the same model, and a timeout is not retried (a retry would double a 30 s wait).
- Risk: GPT-OSS models are reasoning models. Reasoning tokens probably count against the output cap, so a low MAX_TOKENS can give empty content (BAD_RESPONSE). Unconfirmed; the live smoke test decides.
- Unverified: free-tier limits for these models, the 429 shape, and the error code for a removed model. Mocked tests do not prove live availability.
- What would change this: Groq changing free models or limits (one-file change in llm.js plus env).

## D-040: Prompt rules and the prompt-injection stance

- Context: repo files are attacker-controllable text that goes into the prompt.
- Decision: the system prompt says answer only from numbered excerpts, cite [n], say a fixed sentence when the answer is absent, and treat everything inside <excerpts> and <history> as untrusted data, never instructions, never reveal the prompt. Excerpts sit in <excerpt n path lines> delimiters. Delimiter lookalikes in untrusted text are stripped, and paths are sanitised, so repo text cannot close a tag early.
- Why: delimiters plus a stated rule reduce injection; they do not eliminate it. The model may still be fooled, and the output is only text (no tools, no secrets in the prompt), which limits the damage.
- History: last 4 turns, each field capped at 500 chars, in a <history> block before the excerpts, with a rule that old [n] must not be reused.
- What would change this: adding tools or actions for the model, which would need much stricter handling.

## D-041: Token budget and trimming

- Decision: excerpts are budgeted at MAX_EXCERPT_TOKENS 3000, estimated as chars/4 (an ESTIMATE; code is usually denser, so real usage is higher). Lowest score is dropped first until it fits. An excerpt is never cut; usedHits are renumbered 1..n in shown order.
- Why: free tiers have small per-minute token limits. Cutting an excerpt would break its line-range citation.
- Edge: if one excerpt alone exceeds the budget, nothing is used and the not-found path is taken without an LLM call. Merged hits are capped at 4500 chars (about 1125 tokens), so this is rare.
- What would change this: Groq's reported usage showing the estimate is far off.

## D-042: Placeholder threshold and the not-found path

- Decision: if there are no hits, or the best score is below SEARCH_MIN_SCORE, answerQuestion returns { notFound: true } and never calls the LLM. Default 0.5 is a PLACEHOLDER that filters almost nothing (BGE scores are compressed, D-023).
- Why: saves free quota and prevents confident answers on off-topic questions, but only once the number is measured.
- Calibration: Phase 10 eval, from top scores of correct versus off-topic questions.
- If the model itself says the excerpts lack the answer, that is returned as a normal answer.

## D-043: Citation validation

- Decision: extractCitations parses [n] and [n, m], keeps only 1..usedHits.length, removes invalid numbers from the text, and marks each source cited true or false. Markers right after a word character or ")" (like items[7]) are treated as code and left alone.
- Why: a made-up [7] must never render as a source link.
- Limit: a[0][1] counts the second [1] as a citation. A cited:true flag proves the number is valid, not that the claim is supported.

## D-044: Provider isolation in llm.js

- Decision: only llm.js knows Groq (endpoint, auth, body, error codes). Everything else uses chat, generate and LlmError. Errors use fixed messages and carry only the status, a short lowercase provider code and retryAfterSeconds, never bodies, headers or the key. prompt.js and answer.js are pure or provider-neutral.
- Why: same reason as D-022: free tiers die, and swapping provider is a one-file change.

## D-045: Store every exchange in `messages`

- Context: the chat UI needs history after a reload, and follow-ups need earlier turns.
- Decision: every successful ask (answered or not-found) is saved as one Message: question, answer (null when not found), notFound, sources with SHA-pinned URLs, cited flag, model, usedFallback. expiresAt is copied from the repo, so messages expire with it. Demo repos have none. Deleting a repo deletes its messages; if that step fails, the TTL cleans up.
- Why: one document per exchange keeps reads and deletes simple. Sources are stored with their URL so old answers stay valid after the repo changes.
- Trade-off: retrieved text and scores are not stored, so a past answer cannot be re-audited. `n` is stored per source so [n] markers in the answer map back to links.
- What would change this: the Phase 10 eval needing per-answer scores, or storage pressure.

## D-046: History is the last 4 answered turns, read from the database

- Decision: the ask route loads the newest 4 messages for this repo and user where notFound is false, reverses them to oldest first, and passes them to buildMessages (which also caps each field at 500 chars).
- Why: the server is the source of truth, so a client cannot inject fake history. Not-found turns have no answer, so they are left out.
- Limit: retrieval still uses only the raw question. A vague follow-up ("where is that handled?") retrieves poorly until Phase 11 rewrites it.
- What would change this: Phase 11 query rewriting.

## D-047: Ask error mapping, and failed exchanges are not saved

- Decision: Embedding and LLM RATE_LIMITED -> 503 with Retry-After (provider value when known, else 60). QUOTA_EXHAUSTED -> 503. AUTH_FAILED -> logged server-side, client gets a generic 500. TIMEOUT -> 504. Everything else from a provider -> 502. Unknown errors go to the central handler (500). Messages are authored in the route, never provider text.
- Not saved on failure: the Message is created only after the pipeline succeeds, so history never contains a question with no answer. The user just asks again.
- Why: the client can tell "try later" (503), "we are broken" (500) and "provider failed" (502) apart without learning anything about keys or providers.
- Trade-off: if Message.create fails after a successful LLM call, the answer is lost and the user gets a 500.

## D-048: 404 for other users' repos on ask and messages

- Decision: ask and messages use the same findOwned lookup as every other repo route (D-031): { \_id, userId }, identical 404 body for missing and not-yours. Readiness (409) is checked only after ownership. History queries also filter on userId.
- Why: no existence leak, and no code path loads another user's repo or messages.
- Note: zod validation runs before the ownership lookup, so a bad body returns 400 even on someone else's repo. That reveals nothing.

## D-049: Normalize and validate model-generated citations

- Context: GPT-OSS sometimes emits Unicode citation markers such as 【n】 instead of ASCII [n].
- Decision: accept both formats, validate citation numbers against the excerpts actually sent, normalize valid citations to ASCII, remove invalid citations and mark corresponding sources as cited.
- Safety: preserve the guard against interpreting array indexing such as items[7] as citations.
- Limitation: browsing-style markers such as 【3†L1-L5】 are not supported.
- Why: model output is untrusted; source links must correspond only to valid retrieved excerpts.

## D-050: react-router-dom is the only client dependency added

- Context: the app needs /login, /repos and /repos/:id with deep links and protected routes.
- Options considered: hand-rolled routing on window.location and history; react-router-dom.
- Decision: react-router-dom. Everything else (state, fetch, styling) stays plain React and plain CSS.
- Why: deep links, redirect-with-return-path and the back button are easy to get subtly wrong by hand.
- What would change this: a UI so small that two views and a state variable are enough.

## D-051: Auth state in React context, /api/me is the source of truth

- Decision: AuthProvider calls /api/me on start (loading, authenticated, anonymous). Nothing about the user is stored in the browser, and the httpOnly cookie is invisible to JS. Any 401 from a non-auth call sets anonymous, and RequireAuth redirects to /login. Login and signup 401s are excluded (they mean wrong credentials).
- Why: no stale client copy of auth. The handler is idempotent and /login makes no API calls, so there is no redirect loop.
- Trade-off: a network failure during the initial /api/me looks like signed out.
- What would change this: needing offline state or multi-tab sync.

## D-052: Cold-start banner

- Decision: api.js starts a 4 s timer per request. If it fires, a registered callback shows "Server is waking up, this can take about a minute". A counter hides the banner when the last slow request ends. Requests have a 75 s timeout, longer than a Render cold start. The ask call opts out (LLM answers are slow but not a cold start).
- Why: Render free sleeps after 15 idle minutes. Without a message the first load looks broken.
- Limit: any request slower than 4 s shows the banner, even if the server is awake.

## D-053: Server and model text is rendered as plain text only

- Decision: dangerouslySetInnerHTML is banned in this project. Server messages, repo text and model answers go through React's normal escaping. The rule is stated in a comment in components.jsx.
- Why: repo files and LLM output are attacker-controllable. Rendering them as HTML would turn prompt injection into XSS.
- What would change this: wanting rendered markdown answers, which needs a sanitiser decision first (8C will render plain text).

## D-054: Poll the list every 3 s, only while something is active

- Context: the client must learn when indexing finishes (D-032: 202 plus polling).
- Decision: poll GET /api/repos (not each repo) every 3 s while any repo is queued or indexing. Polling stops when none is active, when the tab is hidden (resumes with an immediate fetch on return), and on unmount. One request at a time (an in-flight flag). After a failed poll the delay doubles (3, 6, 12, 24, then 30 s cap) and resets on success. Results arriving after unmount are ignored. Polls do not trigger the waking banner; only the first load does.
- Why: one list request covers every repo, and nothing is sent when idle or hidden, which saves the shared free-tier budget and keeps Render awake only while work is running.
- Trade-off: progress can be up to 3 s stale. Hidden tabs see no updates until visible again.
- What would change this: needing instant updates (SSE) or many concurrent repos.

## D-055: Server error codes become readable messages in one pure table

- Decision: formatError(err) in repoHelpers.js maps INVALID_URL, VALIDATION_ERROR, REPO_EXISTS, INGEST_IN_PROGRESS, REPO_LIMIT_REACHED and BUSY to messages written in the client. Any other code falls back to the error's own message, then to a generic one. BUSY says "about a minute" because the client does not read the Retry-After header.
- Why: server messages are fine for developers but some are not instructions for a user (VALIDATION_ERROR reads "url: is required"). A pure table is easy to test.
- Tests: the helpers live in client/src/repoHelpers.js (no imports) and are tested from server/test/repoHelpers.test.js, so the client needs no test runner or new dependency. Page behaviour (polling, delete) is not unit tested.
- What would change this: a client test setup being added for component tests.

## D-056: Delete needs a confirm step, except removing a failed repo

- Decision: Delete on a ready or active repo shows "Delete this repository and its chat history? Yes, delete / Cancel" inline. Failed repos have a single Remove button because nothing of value is lost, and it doubles as re-index (remove, then add again). The server's text is shown for delete errors, so deleting an active repo shows the 409 message. A 404 on delete means it is already gone, so the row is removed.
- Why: delete is irreversible (chunks and messages go too). An inline confirm avoids window.confirm and needs no modal.
- Trade-off: active repos show a Delete button that always ends in the 409 message. Kept so the server rule is visible and testable from the UI.
- What would change this: real cancellation (D-033), which would make Delete on an active repo meaningful.

## D-057: Model output is plain text; only github.com URLs become links

- Context: answers come from an LLM that reads attacker-controllable repo files. Source URLs are built by our server, but they are stored data.
- Decision: answers, questions and server messages render as React text (never dangerouslySetInnerHTML, D-053). linkifyCitations returns only `text` and `cite` segments, so it cannot produce HTML. A source becomes a link only if its URL starts with `https://github.com/` (isGithubUrl); otherwise the path shows as text. Links use target=\_blank with rel="noopener noreferrer".
- Why: a prompt-injected answer must not become XSS, and a poisoned URL (`javascript:`, `data:`, a lookalike host) must not become a clickable link. The allowlist is checked in the client even though the server built the URL: defence in depth.
- Trade-off: no markdown or code highlighting in answers; fenced code shows as plain text.
- What would change this: rendered markdown, which needs a sanitiser decision first.

## D-058: Citation chips

- Decision: [n] and 【n】 markers become small buttons that scroll to the matching source and highlight it for 2 s. A marker with no matching source stays plain text. Code spans and fences are passed through untouched, and a marker right after a word character or ")" is code (items[7]). Adjacent markers and groups [1, 3] each become a chip.
- Why: chips are buttons, not links, because the source list is on the same page. Pure function, so every edge case is unit tested.
- Limit: a chip proves the number exists in the sources, not that the claim is supported. Sources show cited first, with a "cited" badge.
- What would change this: Phase 9 streaming, where partial text needs incremental parsing.

## D-059: Errors keep the typed question

- Decision: the textarea is cleared only after a successful answer. While a request is pending it is readOnly (not disabled, so focus is kept) and Send is disabled. Failures show a message mapped from the server code (formatAskError), and the question stays for a retry. Rate limit and quota messages say to wait about a minute (the client does not read Retry-After). A missing repo on load redirects to /repos with a notice; a failed ask is not added to history, matching the server (D-047). An empty question is caught locally.
- Why: retyping a question after a 503 is the most annoying failure; the server never saves failed exchanges, so the UI must not show them either.
- What would change this: reading Retry-After to show an exact wait.
