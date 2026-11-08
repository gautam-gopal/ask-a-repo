# Retrieval evaluation findings

Numbers come from `server/eval/results.csv` and `server/eval/runs/*.md`. `TODO` means not run yet. Nothing here is a measured claim beyond what the runs show.

## 1. Setup

- Metric: file-level hit, any expected FILE in the top 5 (D-078). Retrieval only, no LLM.
- Embeddings: @cf/baai/bge-base-en-v1.5, 768 dims, cosine, Atlas $vectorSearch with repoId pre-filter, numCandidates 100.
- Repos (two, pinned): gautam-gopal/ask-a-repo @ 76d6d81, gautam-gopal/imessage @ 92aea87.
- Questions: 38. 30 on-topic (8 exact-identifier, 10 conceptual, 6 multi-file, 6 overview) and 8 off-topic. Written by me, who knows both repos.
- Defaults under test: window 50, overlap 10, max-chars 1500, path prefix on, query prefix off, merge on.

## 2. Baseline (tests indexed, 873 chunks)

| group              |   n | hit@1 | hit@3 | hit@5 |   MRR |
| ------------------ | --: | ----: | ----: | ----: | ----: |
| overall (on-topic) |  30 | 36.7% | 73.3% | 80.0% | 0.547 |
| exact-identifier   |   8 | 12.5% | 62.5% | 75.0% | 0.358 |
| conceptual         |  10 | 40.0% | 80.0% | 90.0% | 0.620 |
| multi-file         |   6 | 50.0% | 83.3% | 83.3% | 0.667 |
| overview           |   6 | 50.0% | 66.7% | 66.7% | 0.556 |

## 3. Exclude-tests experiment (B2, 560 chunks)

Excluding 58 test files cut the corpus from 873 to 560 chunks (-36%).

| group              |   n | hit@1 |  hit@3 |  hit@5 |   MRR |
| ------------------ | --: | ----: | -----: | -----: | ----: |
| overall (on-topic) |  30 | 46.7% |  86.7% |  86.7% | 0.650 |
| exact-identifier   |   8 | 12.5% | 100.0% | 100.0% | 0.542 |
| conceptual         |  10 | 60.0% |  90.0% |  90.0% | 0.733 |
| multi-file         |   6 | 66.7% |  83.3% |  83.3% | 0.750 |
| overview           |   6 | 50.0% |  66.7% |  66.7% | 0.556 |

hit@5 went from 24/30 to 26/30, a difference of two questions. Both baseline exact-identifier failures (im-exact-02, im-exact-03) were test files outranking the implementation, and both are fixed. Adopted in production as INDEX_EXCLUDE_TESTS, default true (D-087).

## 4. Variants against B2

| label         | change               | hit@1 | hit@3 | hit@5 |   MRR |
| ------------- | -------------------- | ----: | ----: | ----: | ----: |
| no-tests (B2) | reference            | 46.7% | 86.7% | 86.7% | 0.650 |
| b2-nomerge    | merge off            | 46.7% | 80.0% | 86.7% | 0.639 |
| b2-qprefix    | query prefix on      | 46.7% | 76.7% | 83.3% | 0.604 |
| b2-max1000    | max-chars 1000       | 46.7% | 73.3% | 83.3% | 0.607 |
| b2-w30o5      | window 30, overlap 5 | 36.7% | 80.0% | 83.3% | 0.575 |

On hit@5 no variant differs from B2 by more than one question (26/30 vs 25/30 or 26/30). On hit@1 and hit@3 some differ by up to three questions (w30o5 hit@1, qprefix hit@3, max1000 hit@3). At n=30 that is still noise-prone. **None is adopted and none is claimed to be worse.** B2 keeps the existing defaults, so nothing was changed (D-088).

## 5. Threshold (SEARCH_MIN_SCORE), run `no-tests`

- On-topic top scores: min 0.799, p25 0.843, median 0.859, p75 0.872, max 0.889 (n=30).
- Off-topic top scores: min 0.767, p25 0.781, median 0.790, p75 0.814, max 0.845 (n=8).
- Policy: highest threshold in steps of 0.005 that rejects zero on-topic questions, provided it rejects some off-topic ones.
- Result: **0.795**. It passes 30/30 on-topic (6/6 overview) and rejects 4/8 off-topic, so 4/8 off-topic questions still reach the model.
- At 0.800 one on-topic question is rejected (im-overview-01, top score 0.7988), which is also an overview question (5/6).
- The margin is 0.004. One on-topic question defines the threshold. A question scoring below 0.795 would be wrongly refused.
- **Provisional.** Reasons: small sample; the threshold was tuned on the same questions it is scored on; the on-topic and off-topic ranges overlap (D-023), so no threshold separates them; the prompt's "excerpts do not contain the answer" rule is the second layer. It was only measured with tests excluded and query prefix off, which is the production setup.

## 6. Failure analysis (4 remaining B2 misses)

The causes below are guesses; I did not test them.

- im-concept-03 (one direct conversation per user pair): frontend store chunks rank first. Likely the store has more conversation-related text than the small backend helper and model.
- im-multi-01 (trace a direct message through 5 files): top hits are the frontend store and the conversation controller. Likely one long question cannot be close to five different chunks.
- im-overview-01 (what kind of app, main workflows): frontend hooks and store rank first. Likely no chunk summarises the app, so the question matches whatever code mentions conversations most.
- im-overview-02 (frameworks and libraries): store chunks outrank both package.json files. Likely a dependency list embeds poorly against a prose question.

All four are imessage questions where frontend files outrank backend ones. Hybrid keyword search (Phase 11) might help the identifier-style cases; it is not built.

## 7. Cost of excluding tests (test-targeted questions)

Four questions whose answers are located in test files were evaluated separately. They are excluded from the headline metrics and threshold sweep.

| run          | exclusion | test-targeted hit@1 |  hit@3 |  hit@5 |   MRR |
| ------------ | --------- | ------------------: | -----: | -----: | ----: |
| b3-test-excl | on        |                0.0% |   0.0% |   0.0% | 0.000 |
| b3-test-incl | off       |              100.0% | 100.0% | 100.0% | 1.000 |

- With exclusion enabled, all 4 test-targeted questions missed their expected files.
- With exclusion disabled, all 4 questions retrieved their expected files at rank 1.
- Decision: adopt test exclusion as the production default (D-087), prioritizing normal implementation retrieval.
- Trade-off: questions such as "How is X tested?" will not work reliably with exclusion enabled.
- The result is based on only 4 test-targeted questions, so it should not be generalized beyond this evaluation.

## 8. Limitations

- 30 on-topic questions, two repos, both JavaScript. One question moves hit@5 by 3.3 points and off-topic rejection by 12.5 points.
- I wrote the questions and know the repos. B2 and the threshold were chosen after seeing results on the same questions, so the reported numbers are optimistic.
- File-level hit does not check that the right lines or enough context were retrieved, and it says nothing about answer quality.
- Exclude-tests confound: removing 36% of chunks makes any retrieval easier, and none of the 30 headline questions target test files. The B2 gain is not purely "tests were noise". Section 7 measures the cost.
- Scores are compressed, so the score gate only catches the clearest misses.
- The 512-token check is a chars/4 estimate. Window and max-chars interact (D-079).

## 9. Next

The retrieval evaluation for the current implementation is complete.

The production configuration uses:

- 50-line chunk windows with 10-line overlap and a 1500-character maximum.
- File paths included in the embedded document text.
- Query prefix disabled.
- Adjacent retrieval hits merged.
- Test and spec files excluded by default.
- `SEARCH_MIN_SCORE=0.795` as a provisional retrieval threshold.

Phase 11 (hybrid search and follow-up retrieval improvements) was skipped. The current implementation uses semantic vector search only.

Potential future evaluation work:

- Expand the evaluation dataset with more repositories, programming languages and independently written questions.
- Introduce a held-out question set to reduce tuning bias.
- Evaluate exact-identifier retrieval separately, particularly for function names and variable names.
- Evaluate answer correctness, citation accuracy and groundedness in addition to file-level retrieval metrics.
- Revisit test-file exclusion if questions about test coverage and test implementation become a priority.

The current results should be interpreted within the limitations documented in Section 8. In particular, the B2 improvement is two additional questions out of 30, and the threshold was tuned on the same small dataset used for evaluation.
