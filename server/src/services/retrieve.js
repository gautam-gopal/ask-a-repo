// Retrieval only: embed the question, vector-search one repo, merge adjacent hits.
// No LLM and no score threshold here (threshold comes from the Phase 10 eval).
import mongoose from "mongoose";
import { Chunk, VECTOR_INDEX_NAME } from "../models/Chunk.js";
import { embedQuery } from "./embeddings.js";

export const NUM_CANDIDATES = 100; // nearest neighbours examined (about 12x the limit)
export const CANDIDATE_LIMIT = 8; // raw hits returned by Mongo before merging
export const DEFAULT_LIMIT = 5; // merged hits returned to the caller
export const MAX_MERGED_CHARS = 4500; // a merge that would exceed this is not done

export function buildPipeline(repoOid, queryVector) {
  return [
    {
      $vectorSearch: {
        index: VECTOR_INDEX_NAME,
        path: "embedding",
        queryVector,
        numCandidates: NUM_CANDIDATES,
        limit: CANDIDATE_LIMIT,
        // Pre-filter inside the vector query; repoId must be a real ObjectId
        // (aggregate() does not cast) and declared as a filter field in the index.
        filter: { repoId: { $eq: repoOid } },
      },
    },
    { $unset: "embedding" }, // explicit: the 768-number vector never leaves Mongo
    {
      $project: {
        _id: 0,
        path: 1,
        startLine: 1,
        endLine: 1,
        text: 1,
        score: { $meta: "vectorSearchScore" },
      },
    },
  ];
}

const pick = (h) => ({
  path: h.path,
  startLine: h.startLine,
  endLine: h.endLine,
  text: h.text,
  score: h.score,
  mergedFrom: 1,
});

// Returns the merged hit, or null when merging would exceed maxChars.
function tryAbsorb(cur, h, maxChars) {
  const score = Math.max(cur.score, h.score);
  const mergedFrom = cur.mergedFrom + 1;
  if (h.endLine <= cur.endLine) return { ...cur, score, mergedFrom }; // contained
  // Lines startLine..cur.endLine are already in cur.text; append only the new ones.
  const skip = cur.endLine + 1 - h.startLine;
  const text = cur.text + "\n" + h.text.split("\n").slice(skip).join("\n");
  if (text.length > maxChars) return null;
  return { ...cur, endLine: h.endLine, text, score, mergedFrom };
}

// Pure. Merges hits from the same file whose line ranges overlap or touch
// (next.start <= prev.end + 1). Merged hit: combined range, max score, text with
// each line once. Output sorted by score desc, cut to `limit`.
//
// LONG-LINE RULE: the chunker splits one over-long line into character segments that
// ALL carry that line's number (startLine === endLine) and do not overlap. A hit with
// startLine === endLine is therefore treated as a "point hit" and is NEVER merged:
// its text may be only part of the line, we have no segment offset, and merging by line
// numbers would drop or misorder text. Cost: a genuine one-line chunk is not merged
// with its neighbours (rare, harmless).
// SIZE RULE: a merge that would push text past maxChars is skipped; the hit stays separate.
export function mergeAdjacentHits(
  hits,
  { limit = DEFAULT_LIMIT, maxChars = MAX_MERGED_CHARS } = {},
) {
  const out = [];
  const byPath = new Map();
  for (const h of hits) {
    if (h.startLine === h.endLine) {
      out.push(pick(h));
      continue;
    }
    if (!byPath.has(h.path)) byPath.set(h.path, []);
    byPath.get(h.path).push(h);
  }
  for (const group of byPath.values()) {
    group.sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
    let cur = null;
    for (const h of group) {
      if (cur && h.startLine <= cur.endLine + 1) {
        const merged = tryAbsorb(cur, h, maxChars);
        if (merged) {
          cur = merged;
          continue;
        }
      }
      if (cur) out.push(cur);
      cur = pick(h);
    }
    if (cur) out.push(cur);
  }
  out.sort(
    (a, b) =>
      b.score - a.score ||
      a.path.localeCompare(b.path) ||
      a.startLine - b.startLine,
  );
  return out.slice(0, limit);
}

export async function retrieve({ repoId, query, limit = DEFAULT_LIMIT }) {
  const repoOid = new mongoose.Types.ObjectId(String(repoId));
  const queryVector = await embedQuery(query);
  const hits = await Chunk.aggregate(buildPipeline(repoOid, queryVector));
  return mergeAdjacentHits(hits, { limit });
}
