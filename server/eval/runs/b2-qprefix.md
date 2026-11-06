# Eval run: b2-qprefix

Date: 2026-11-06T21:28:33.481Z

## Settings
- window 50, overlap 10, max-chars 1500
- path prefix on, query prefix on, merge on, exclude-tests on
- model @cf/baai/bge-base-en-v1.5, 768 dims, top 5
- repo askarepo: gautam-gopal/ask-a-repo @ 76d6d81d90e61b5985b6d114edb6dd0f968e28ec (pin with "sha" in questions.json to freeze it)
- repo imessage: gautam-gopal/imessage @ 92aea87238e93e80b2e67b8380426b262f1756fe (pin with "sha" in questions.json to freeze it)

## Chunks
- 560 chunks, avg 1265.9 chars, max 1500
- estimated over 512 tokens (chars/4, an estimate): 0 (0.0%)
- neurons used (estimate): 8.5; cache 560 hits, 38 misses

## Metrics (file-level hit)
A hit means any expected FILE appears in the top 5. Line ranges are not scored: chunk boundaries change with window, overlap and max-chars, so line labels would not be comparable across runs (D-078). MRR counts the top 5 only.

| group | n | hit@1 | hit@3 | hit@5 | MRR | avg rank of first hit |
|---|---|---|---|---|---|---|
| overall (on-topic) | 30 | 46.7% | 76.7% | 83.3% | 0.604 | 1.84 |
| exact-identifier | 8 | 37.5% | 100.0% | 100.0% | 0.625 | 2.00 |
| conceptual | 10 | 50.0% | 70.0% | 80.0% | 0.587 | 2.00 |
| multi-file | 6 | 50.0% | 66.7% | 83.3% | 0.625 | 1.80 |
| overview | 6 | 50.0% | 66.7% | 66.7% | 0.583 | 1.25 |

## Top-score distributions (for the 10B threshold)
- on-topic: n 30, min 0.779, p25 0.813, median 0.831, p75 0.842, max 0.882
- off-topic: n 8, min 0.745, p25 0.761, median 0.766, p75 0.789, max 0.839

## Failed questions (5)
- **im-concept-01** [conceptual] How does an authenticated HTTP request resolve a Clerk identity to the application's local user record?
  - expected: backend/src/middleware/auth.middleware.js
  - got: backend/src/lib/ai/assistant-user.js:1-40 (0.838); backend/src/webhooks/clerk.webhook.js:1-58 (0.815); frontend/src/store/useChatStore.js:390-475 (0.791)
- **im-concept-03** [conceptual] How does the application ensure that the same pair of users resolves to one direct conversation?
  - expected: backend/src/lib/conversations.js, backend/src/models/conversation.model.js
  - got: frontend/src/store/useChatStore.js:819-862 (0.821); frontend/src/store/useChatStore.js:519-550 (0.811); frontend/src/store/useChatStore.js:701-740 (0.807)
- **im-multi-01** [multi-file] Trace sending a direct message from the authenticated HTTP route through conversation resolution, database persistence, and real-time Socket.IO delivery.
  - expected: backend/src/routes/message.route.js, backend/src/controllers/message.controller.js, backend/src/lib/conversations.js, backend/src/lib/socket.js, backend/src/models/message.model.js
  - got: backend/src/controllers/conversation.controller.js:217-265 (0.800); frontend/src/store/useChatStore.js:56-131 (0.797); frontend/src/store/useChatStore.js:421-475 (0.793)
- **im-overview-01** [overview] What kind of messaging application is iMessage, and what main user workflows are supported?
  - expected: frontend/src/App.jsx, backend/src/routes/message.route.js, backend/src/routes/conversation.route.js
  - got: frontend/src/hooks/useSelectedConversation.js:41-127 (0.779); frontend/src/components/chat/MessageList.jsx:31-82 (0.778); frontend/src/store/useChatStore.js:731-770 (0.776)
- **im-overview-02** [overview] Which main frameworks, libraries, and services does iMessage use on its frontend and backend?
  - expected: frontend/package.json, backend/package.json
  - got: frontend/src/store/useChatStore.js:358-399 (0.789); frontend/src/store/useChatStore.js:731-770 (0.786); frontend/src/store/useChatStore.js:56-99 (0.784)

## Off-topic questions
- **ar-off-01** top score 0.767: How are Stripe subscription payments, invoices, and refunds implemented?  (got: PROJECT.md:342-363 (0.767); PROJECT.md:238-261 (0.758); PROJECT.md:106-119 (0.755))
- **ar-off-02** top score 0.783: How does the application send password-reset emails through an SMTP provider?  (got: DECISIONS.md:31-50 (0.783); server/src/routes/auth.js:1-81 (0.771); DECISIONS.md:352-365 (0.760))
- **ar-off-03** top score 0.839: How are Redis cache entries invalidated when a repository is re-indexed?  (got: DECISIONS.md:197-219 (0.839); DECISIONS.md:247-272 (0.826); PROJECT.md:184-197 (0.824))
- **ar-off-04** top score 0.763: Which Kubernetes manifests configure horizontal pod autoscaling for the application?  (got: PROJECT.md:181-197 (0.763); PROJECT.md:286-307 (0.763); server/src/services/ingest.js:69-153 (0.759))
- **im-off-01** top score 0.752: How are Stripe subscriptions, recurring charges, and customer invoices managed?  (got: backend/src/lib/read-receipts.js:1-60 (0.752); frontend/src/store/useChatStore.js:819-895 (0.738); frontend/src/hooks/useSelectedConversation.js:41-127 (0.737))
- **im-off-02** top score 0.805: How does the backend transcode uploaded videos into adaptive-bitrate HLS streams?  (got: frontend/src/components/chat/MessageVideo.jsx:1-65 (0.805); backend/src/middleware/upload.middleware.js:1-21 (0.795); backend/src/middleware/file-type.middleware.js:1-27 (0.795))
- **im-off-03** top score 0.766: How are scheduled marketing newsletters sent to users by email?  (got: frontend/src/hooks/useSelectedConversation.js:41-127 (0.766); backend/src/lib/read-receipts.js:34-60 (0.748); frontend/src/store/useChatStore.js:640-710 (0.745))
- **im-off-04** top score 0.745: How does the application calculate employee payroll, tax deductions, and payslips?  (got: backend/src/lib/ai/rate-limit.js:1-28 (0.745); backend/src/controllers/message.controller.js:35-80 (0.742); backend/src/migrations/002-read-state-baseline.js:31-99 (0.740))
