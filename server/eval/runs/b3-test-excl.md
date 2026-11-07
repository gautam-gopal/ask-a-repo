# Eval run: b3-test-excl

Date: 2026-11-07T10:22:41.802Z

## Settings
- window 50, overlap 10, max-chars 1500
- path prefix on, query prefix off, merge on, exclude-tests on
- model @cf/baai/bge-base-en-v1.5, 768 dims, top 5
- repo askarepo: gautam-gopal/ask-a-repo @ 76d6d81d90e61b5985b6d114edb6dd0f968e28ec (pin with "sha" in questions.json to freeze it)
- repo imessage: gautam-gopal/imessage @ 92aea87238e93e80b2e67b8380426b262f1756fe (pin with "sha" in questions.json to freeze it)

## Chunks
- 560 chunks, avg 1265.9 chars, max 1500
- estimated over 512 tokens (chars/4, an estimate): 0 (0.0%)
- neurons used (estimate): 0.4; cache 598 hits, 4 misses

## Metrics (file-level hit)
A hit means any expected FILE appears in the top 5. Line ranges are not scored: chunk boundaries change with window, overlap and max-chars, so line labels would not be comparable across runs (D-078). MRR counts the top 5 only.

| group | n | hit@1 | hit@3 | hit@5 | MRR | avg rank of first hit |
|---|---|---|---|---|---|---|
| overall (on-topic) | 30 | 46.7% | 86.7% | 86.7% | 0.650 | 1.58 |
| exact-identifier | 8 | 12.5% | 100.0% | 100.0% | 0.542 | 2.00 |
| conceptual | 10 | 60.0% | 90.0% | 90.0% | 0.733 | 1.44 |
| multi-file | 6 | 66.7% | 83.3% | 83.3% | 0.750 | 1.20 |
| overview | 6 | 50.0% | 66.7% | 66.7% | 0.556 | 1.50 |
| test-targeted | 4 | 0.0% | 0.0% | 0.0% | 0.000 | - |

## Top-score distributions (for the 10B threshold)
- on-topic: n 30, min 0.799, p25 0.843, median 0.859, p75 0.872, max 0.889
- off-topic: n 8, min 0.767, p25 0.781, median 0.790, p75 0.814, max 0.845

## Failed questions (8)
- **im-concept-03** [conceptual] How does the application ensure that the same pair of users resolves to one direct conversation?
  - expected: backend/src/lib/conversations.js, backend/src/models/conversation.model.js
  - got: frontend/src/store/useChatStore.js:819-862 (0.855); frontend/src/store/useChatStore.js:519-550 (0.844); backend/src/controllers/message.controller.js:35-80 (0.839)
- **im-multi-01** [multi-file] Trace sending a direct message from the authenticated HTTP route through conversation resolution, database persistence, and real-time Socket.IO delivery.
  - expected: backend/src/routes/message.route.js, backend/src/controllers/message.controller.js, backend/src/lib/conversations.js, backend/src/lib/socket.js, backend/src/models/message.model.js
  - got: frontend/src/store/useChatStore.js:421-475 (0.821); backend/src/controllers/conversation.controller.js:217-265 (0.820); frontend/src/store/useChatStore.js:56-131 (0.817)
- **im-overview-01** [overview] What kind of messaging application is iMessage, and what main user workflows are supported?
  - expected: frontend/src/App.jsx, backend/src/routes/message.route.js, backend/src/routes/conversation.route.js
  - got: frontend/src/hooks/useSelectedConversation.js:41-89 (0.799); frontend/src/store/useChatStore.js:731-770 (0.799); frontend/src/components/chat/MessageList.jsx:31-82 (0.792)
- **im-overview-02** [overview] Which main frameworks, libraries, and services does iMessage use on its frontend and backend?
  - expected: frontend/package.json, backend/package.json
  - got: frontend/src/store/useChatStore.js:731-770 (0.819); frontend/src/store/useChatStore.js:56-99 (0.811); frontend/src/store/useChatStore.js:358-399 (0.808)
- **ar-test-01** [test-targeted] How is parseRepoUrl rejecting hostile or malformed repository URLs tested?
  - expected: server/test/github.test.js
  - got: server/src/services/github.js:41-95 (0.871); PROJECT.md:152-167 (0.866); server/src/routes/repos.js:152-267 (0.862)
- **ar-test-02** [test-targeted] Where is it tested that an expired or forged auth token is rejected?
  - expected: server/test/auth.middleware.test.js
  - got: server/src/middleware/auth.js:1-54 (0.852); PROJECT.md:138-151 (0.848); PROJECT.md:50-57 (0.845)
- **im-test-01** [test-targeted] How are Socket.IO handshake authentication and online presence tested?
  - expected: backend/tests/socket/handshake-and-presence.test.js
  - got: backend/src/lib/socket.js:56-184 (0.833); frontend/src/store/useAuthStore.js:1-84 (0.817); backend/src/lib/socket.js:175-220 (0.806)
- **im-test-02** [test-targeted] How is message pagination tested?
  - expected: backend/tests/api/pagination.test.js
  - got: frontend/src/store/useChatStore.js:573-611 (0.827); backend/src/lib/message-history.js:1-37 (0.817); frontend/src/store/useChatStore.js:441-501 (0.815)

## Off-topic questions
- **ar-off-01** top score 0.785: How are Stripe subscription payments, invoices, and refunds implemented?  (got: PROJECT.md:342-363 (0.785); client/src/pages/ChatPage.jsx:151-199 (0.782); client/src/pages/LoginPage.jsx:33-82 (0.781))
- **ar-off-02** top score 0.812: How does the application send password-reset emails through an SMTP provider?  (got: DECISIONS.md:31-60 (0.812); server/src/routes/auth.js:1-81 (0.803); client/src/pages/LoginPage.jsx:33-110 (0.789))
- **ar-off-03** top score 0.845: How are Redis cache entries invalidated when a repository is re-indexed?  (got: DECISIONS.md:197-219 (0.845); server/src/routes/repos.js:227-304 (0.840); client/src/repoHelpers.js:27-45 (0.836))
- **ar-off-04** top score 0.795: Which Kubernetes manifests configure horizontal pod autoscaling for the application?  (got: server/src/services/ingest.js:69-113 (0.795); PROJECT.md:309-328 (0.794); PROJECT.md:186-199 (0.793))
- **im-off-01** top score 0.773: How are Stripe subscriptions, recurring charges, and customer invoices managed?  (got: backend/src/lib/read-receipts.js:1-60 (0.773); frontend/src/hooks/useSelectedConversation.js:1-89 (0.763); frontend/src/store/useChatStore.js:819-895 (0.762))
- **im-off-02** top score 0.819: How does the backend transcode uploaded videos into adaptive-bitrate HLS streams?  (got: backend/src/middleware/upload.middleware.js:1-21 (0.819); frontend/src/components/chat/MessageVideo.jsx:1-65 (0.818); backend/src/middleware/file-type.middleware.js:1-27 (0.818))
- **im-off-03** top score 0.784: How are scheduled marketing newsletters sent to users by email?  (got: frontend/src/hooks/useSelectedConversation.js:1-127 (0.784); backend/src/seeds/message.seed.js:1-58 (0.773); backend/src/lib/read-receipts.js:34-60 (0.767))
- **im-off-04** top score 0.767: How does the application calculate employee payroll, tax deductions, and payslips?  (got: backend/src/lib/ai/rate-limit.js:1-28 (0.767); backend/src/migrations/002-read-state-baseline.js:31-80 (0.766); backend/src/index.js:61-110 (0.763))
