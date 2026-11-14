# Status

## Current phase

Phase 14 (UI polish) is implemented: 14A (design system), 14B (Markdown answers) and 14C (chat layout and final polish). Remaining: run the 14C verification checklist and record the Lighthouse result and the production CSP console check.

Phases 0 to 10, 12, 13 and 14 are complete. Phase 11 (hybrid search) was skipped and Docker was deferred (D-098).

## What works

- Live at https://ask-a-repo.onrender.com (Render free, auto-deploy from `main`): authentication, GitHub integration, chunker (50-line windows, 10-line overlap, 1500-character maximum), Cloudflare Workers AI embeddings (768 dimensions), MongoDB Atlas Vector Search (`chunks_vector`), ingestion, retrieval, Groq answers (gpt-oss-120b with gpt-oss-20b fallback), SSE streaming, message persistence, retrieval evaluation, rate limits, daily budgets, signup cap, CSP, redacted logs, CI and read-only demo mode.
- Phase 14A: design tokens, DESIGN.md, header and shell, login and repositories pages (D-106 to D-110).
- Phase 14B: Markdown answers with react-markdown and remark-gfm (pinned), no raw HTML, GitHub-only link allowlist, no images, citation chips from a remark plugin on text nodes, copyable code blocks (D-111 to D-116).
- Phase 14C:
  - Two-column chat from 1100px: 820px conversation plus a 280px sticky repository sidebar (owner/name and short commit SHA link to GitHub). Below 1100px the sidebar is a compact strip (D-117).
  - Conversation blocks: tinted question block, full-width answer block with label, model and timestamps, turn dividers, calm not-found notice, Stopped and Interrupted markers (D-118).
  - Collapsible sources per answer: "N sources, M cited", cited first, quiet uncited rows, middle-truncated paths, chip click expands, scrolls, highlights and focuses, chip hover highlights the row (D-119).
  - Sticky composer with auto-growing capped textarea, Send busy state, Stop, counter from 400 characters, keyboard hint, safe-area padding, Jump to latest (D-120).
  - Example questions in an empty conversation, fill-only (D-121).
  - Polish: client 404 page, SVG favicon, `viewport-fit=cover`, cold-start banner as a fixed toast (no layout shift), loading state for history, consistent button classes on the chat page.
  - Intentionally not done: D-122.
- Automated tests: 647 passed before 14C. 14C adds `server/test/chatLayoutHelpers.test.js` (middle truncation, sources grouping and counting, GitHub link builders, time formatting, examples). Record the new total after running.
- Production indexing skips test files by default (D-087). `SEARCH_MIN_SCORE=0.795` remains provisional (D-089).
- Retrieval evaluation (30 on-topic, 8 off-topic questions, 2 repositories): baseline Hit@5 80.0%; B2 Hit@5 86.7%. Test-targeted questions: 0/4 with test exclusion and 4/4 without.
- `DECISIONS.md` contains D-001 to D-122. `BUGS.md` contains B-001.

## What is broken or unverified

- 14C visual and behavioural checks (breakpoints 360 to 1920, sticky composer, Jump to latest, citation focus, reduced motion) are not yet recorded.
- Lighthouse accessibility score for the chat page is not yet recorded.
- Production browser console not yet confirmed free of CSP violations. The textarea auto-grow relies on CSSOM style writes being allowed (D-120).
- Manual browser prompt-injection test for Markdown output not recorded. Automated tests in `server/test/markdown.test.js` cover hostile HTML, unsafe links and image attempts.
- The client 404 page is served with HTTP 200 (SPA fallback).
- `DAILY_LLM_REQUEST_BUDGET=500` is still a placeholder pending the Groq dashboard check.
- Budgets are estimates. In-memory rate limiters reset on restart and are not shared across instances.
- Existing non-demo repositories indexed before test exclusion may still contain test chunks.
- Four B2 retrieval failures remain. The evaluation set is small and the threshold was tuned on it.
- Demo visitors share an IP-based rate-limit bucket and get no follow-up context.
- Phase 11 hybrid search, Docker and linting remain deferred.
- README screenshots are placeholders until `docs/images/login.png`, `repos.png` and `chat.png` are added.

## Files added or changed (14C)

- Added: `client/src/components/RepoInfo.jsx`, `client/src/components/SourcesPanel.jsx`, `client/src/pages/NotFoundPage.jsx`, `client/public/favicon.svg`, `server/test/chatLayoutHelpers.test.js`.
- Changed: `client/src/pages/ChatPage.jsx` (rewritten), `client/src/chatHelpers.js`, `client/src/styles.css`, `client/src/components.jsx`, `client/src/App.jsx`, `client/index.html`, `README.md` (Screenshots section only), `DECISIONS.md`, `STATUS.md`.

## Next

Run the verification checklist, fix anything it finds, add the three screenshots, then the remaining Phase 13 and 14 interview preparation (README claims traced to measurements).
