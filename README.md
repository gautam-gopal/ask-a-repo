# Ask-a-Repo

[![CI](https://github.com/gautam-gopal/ask-a-repo/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/gautam-gopal/ask-a-repo/actions/workflows/ci.yml)

Protections and known limitations: [docs/PROTECTIONS.md](docs/PROTECTIONS.md)

Ask questions about any public GitHub repository and get answers that cite exact file and line ranges. Full README (architecture, setup, limitations) comes in Phase 13.

## Evaluation

Retrieval only, no LLM. A question is a hit at k when any expected file is in the top k results (file-level, not line-level).

| run                                     | chunks | hit@1 | hit@3 | hit@5 |   MRR |
| --------------------------------------- | -----: | ----: | ----: | ----: | ----: |
| baseline (tests indexed)                |    873 | 36.7% | 73.3% | 80.0% | 0.547 |
| B2 (tests excluded, production default) |    560 | 46.7% | 86.7% | 86.7% | 0.650 |

Settings: window 50, overlap 10, max 1500 characters, file path in the embedded text, no query prefix, adjacent hits merged. Model `@cf/baai/bge-base-en-v1.5`, Atlas `$vectorSearch`.

Caveats: 30 on-topic and 8 off-topic questions over two repositories, written by me, so one question is 3.3 points of hit@5. B2 was chosen after seeing these same questions. Excluding tests also removes 36% of chunks, which makes retrieval easier on its own, and none of the headline questions target test files. Details, failures and limitations: [server/eval/FINDINGS.md](server/eval/FINDINGS.md).
