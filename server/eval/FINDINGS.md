# Retrieval evaluation findings

Fill the TBD cells from `server/eval/results.csv` and `server/eval/runs/*.md`. Never write a number you did not measure.

## 1. Setup

- Metric: file-level hit, any expected FILE in the top 5 (D-078). Retrieval only, no LLM.
- Embeddings: @cf/baai/bge-base-en-v1.5, 768 dims, cosine, Atlas $vectorSearch with repoId pre-filter, numCandidates 100.
- Repos: gautam-gopal/ask-a-repo @ 76d6d81, gautam-gopal/imessage @ 92aea87 (pinned).
- Questions: 30 on-topic (8 exact-identifier, 10 conceptual, 6 multi-file, 6 overview), 8 off-topic.
- Defaults under test: window 50, overlap 10, max-chars 1500, path prefix on, query prefix off, merge on.

## 2. Baseline (873 chunks, avg 1294.6 chars)

| group              |   n | hit@1 | hit@3 | hit@5 |   MRR |
| ------------------ | --: | ----: | ----: | ----: | ----: |
| overall (on-topic) |  30 | 36.7% | 73.3% | 80.0% | 0.547 |
| exact-identifier   |   8 | 12.5% | 62.5% | 75.0% | 0.358 |
| conceptual         |  10 | 40.0% | 80.0% | 90.0% | 0.620 |
| multi-file         |   6 | 50.0% | 83.3% | 83.3% | 0.667 |
| overview           |   6 | 50.0% | 66.7% | 66.7% | 0.556 |

## 3. Experiments (one variable at a time, D-079)

| label      | change                                 | hit@1 | hit@3 | hit@5 | MRR   | vs baseline (hit@5 points) |
| ---------- | -------------------------------------- | ----- | ----- | ----- | ----- | -------------------------- |
| baseline   | none                                   | 36.7% | 73.3% | 80.0% | 0.547 | 0                          |
| qprefix-on | query prefix on                        | TBD   | TBD   | TBD   | TBD   | TBD                        |
| merge-off  | merge off                              | TBD   | TBD   | TBD   | TBD   | TBD                        |
| prefix-off | path prefix off                        | TBD   | TBD   | TBD   | TBD   | TBD                        |
| w30        | window 30                              | TBD   | TBD   | TBD   | TBD   | TBD                        |
| c3000      | max-chars 3000                         | TBD   | TBD   | TBD   | TBD   | TBD                        |
| o0         | overlap 0                              | TBD   | TBD   | TBD   | TBD   | TBD                        |
| no-tests   | exclude tests (experiment only, D-086) | 46.7% | 86.7% | 86.7% | 0.650 | +6.7                       |

One question is 3.3 points of Hit@5 (30 on-topic questions). Differences of one or two questions are noise.

## 4. Threshold (SEARCH_MIN_SCORE)

- On-topic top scores: min 0.799, p25 0.852, median 0.860, p75 0.873, max 0.889 (n=30).
- Off-topic top scores: min 0.767, p25 0.781, median 0.790, p75 0.816, max 0.845 (n=8).
- Threshold sweep: 0.700 to 0.900, increments of 0.005.
- At 0.790: 30/30 on-topic pass, 4/8 off-topic rejected, 6/6 overview pass.
- At 0.795: identical outcomes.
- At 0.800: 29/30 on-topic pass, 5/8 off-topic rejected, 5/6 overview pass.
- Decision: provisional SEARCH_MIN_SCORE = 0.79 (D-084).
- The score ranges overlap. No threshold perfectly separates on-topic and off-topic questions.
- Second layer: the prompt's "excerpts do not contain the answer" rule.
- Limitations: 30 on-topic and 8 off-topic questions across two repositories. Results are indicative, not proof.

## 5. Failure analysis

### Baseline failures

Six on-topic questions missed their expected files in the top 5:

- `im-exact-02` — `containsAssistantMention()`: backend and frontend tests outranked `backend/src/lib/ai/mention.js`.
- `im-exact-03` — `markMessagesReadUpTo()`: tests and a frontend hook outranked `backend/src/lib/read-receipts.js`.
- `im-concept-03` — direct conversation uniqueness: frontend store and tests outranked the backend conversation implementation.
- `im-multi-01` — direct-message lifecycle: frontend store and tests outranked the expected backend route, controller, conversation, socket, and message-model files.
- `im-overview-01` — application workflows: frontend hooks and store outranked the expected application entry point and backend routes.
- `im-overview-02` — technology stack: frontend store and components outranked the expected frontend and backend package manifests.

### Effect of excluding test files

Excluding 58 test files reduced the indexed corpus from 873 to 560 chunks.

- Both exact-identifier failures were fixed: `im-exact-02` and `im-exact-03` now retrieve their expected implementation files in the top 5.
- `im-concept-03` remains unresolved. Frontend store chunks still dominate the results, while the expected backend conversation files remain absent from the top 5.
- `im-multi-01` remains unresolved. Frontend store chunks and conversation-related backend files appear, but the expected message route, message controller, conversation helper, socket, and message model are not retrieved in the top 5.
- `im-overview-01` remains unresolved. Results are dominated by frontend hooks, store, and message-list components rather than the expected application entry point and backend routes.
- `im-overview-02` remains unresolved. Frontend store and component chunks rank above both package manifests.

### Interpretation

Removing test files improved overall on-topic Hit@5 from 80.0% to 86.7% and MRR from 0.547 to 0.650.

The improvement suggests test files were competing with implementation files for exact-identifier retrieval. However, frontend-versus-backend competition and broad overview queries remain difficult.

The no-tests experiment is evaluation-only (D-086). It does not yet establish that production indexing should exclude test files.

## 6. Limitations

- 38 questions (30 on-topic, 8 off-topic), across 2 JavaScript repositories. The sample is small, and the questions may reflect familiarity with the repositories.
- One question changes on-topic Hit@5 by 3.3 percentage points and off-topic rejection by 12.5 percentage points.
- File-level hit does not check whether the correct lines or enough context were retrieved.
- Scores are compressed (D-023), so a score threshold cannot perfectly separate on-topic from off-topic questions.
- The 512-token check is a chars/4 estimate. Retrieval evaluation does not measure answer quality.
- Window and max-chars interact (D-079). Experiments are single-variable.

## 7. What I would do next

- TBD after experiments. Candidates: function-aware chunking (stretch), hybrid keyword search for exact identifiers (Phase 11), a path-based score penalty for test files, a reranker, a larger and more varied question set.
