# Status

## Current phase

Phase 3 complete (chunker). Next: Phase 4A — Cloudflare embeddings service.

## What works

- Live at https://ask-a-repo.onrender.com (Render free, auto-deploy from main). Phases 0 to 2 unchanged: /healthz, React shell, auth (signup, login, logout, /api/me), GitHub client (parseRepoUrl, resolveRepo, fetchTree, filterTree, fetchFileContents, loadRepo).
- `server/src/services/chunker.js`:
  - `chunkFile({ path, text }, { windowLines = 50, overlapLines = 10, maxChunkChars = 1500 })`: pure; returns `[{ path, startLine, endLine, text, embedText }]`.
  - Line numbers are 1-based and inclusive. CRLF and CR become LF. One trailing newline is not a line. Blank-only chunks are skipped.
  - The final window reaching the end of the file stops the loop, so there is no tiny contained tail.
  - A window that exceeds `maxChunkChars` is shortened at a line boundary (minimum 1 line). A single over-long line is split into segments that keep its line number. If the cap shortens a window so the overlap would add no new line, the overlap is skipped at that boundary.
  - Invalid options throw RangeError. `splitLines` is exported for the script and tests.
  - `chunkRepo(files, options)` returns `{ chunks, stats: { files, chunks, avgChars, maxChars } }`.
- `server/scripts/chunk-repo.js <url> [--window N] [--overlap M]`: loads a repo, chunks it, prints stats and the first 2 chunks, and self-checks text-matches-range and full coverage of non-blank lines (PASS or first failure).
- Tests: 126 total (94 earlier plus 32 chunker tests), all passing, no network.
- `DECISIONS.md` has D-001 to D-018.

## What is broken

- Nothing known. `GITHUB_TOKEN` must be set in Render's environment, or the deploy crashes at boot.
- GitHub rate-limit accounting for downloads is still an assumption (1 request per file). Verify with `list-repo.js --fetch` and correct the comment in `github.js` if it differs.
- A 404 on a single file reports the generic "Repository not found, or it is private" message.
- Chunking defaults (50 / 10 / 1500) are provisional and untuned until the Phase 10 evaluation.
- The 1500-character cap does not guarantee that every chunk fits Cloudflare BGE-base's 512-token input limit. Phase 4A must handle oversized embedding inputs without silently truncating or losing source content.
- Long-line segments can split a surrogate pair (accepted).
- No ingestion route yet; nothing is stored.

## Files added or changed

- Added: `server/scripts/chunk-repo.js`, `server/test/chunker.test.js`
- Changed: `server/src/services/chunker.js` (default `maxChunkChars` updated from 4000 to 1500), `DECISIONS.md` (D-015 to D-018), `STATUS.md`

## Next

**Phase 4A — Embeddings service:** Implement `embeddings.js` using Cloudflare Workers AI (`@cf/baai/bge-base-en-v1.5`, 768 dimensions, `cls` pooling), with batching, concurrency limits, timeouts, retries, configuration, mocked tests and a live smoke script.

**Phase 4B — Vector storage and search:** Add the Chunk model, Atlas vector index on `chunks.embedding` with `repoId` as a filter field, and a manual `$vectorSearch` test using approximately 10 chunks.

No ingestion route, background indexing or client changes in Phase 4. Those belong to Phase 5 and later.
