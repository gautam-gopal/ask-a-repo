import { describe, it, expect, vi, beforeEach } from "vitest";
import mongoose from "mongoose";

vi.mock("../src/models/Chunk.js", () => ({
  Chunk: { aggregate: vi.fn() },
  VECTOR_INDEX_NAME: "chunks_vector",
}));
vi.mock("../src/services/embeddings.js", () => ({ embedQuery: vi.fn() }));

import { Chunk } from "../src/models/Chunk.js";
import { embedQuery } from "../src/services/embeddings.js";
import {
  mergeAdjacentHits,
  retrieve,
  retrieveByVector,
  NUM_CANDIDATES,
  CANDIDATE_LIMIT,
} from "../src/services/retrieve.js";

const lines = (a, b) =>
  Array.from({ length: b - a + 1 }, (_, i) => `L${a + i}`).join("\n");
const h = (path, start, end, score = 0.5) => ({
  path,
  startLine: start,
  endLine: end,
  text: lines(start, end),
  score,
});
const range = (x) => [x.startLine, x.endLine];

describe("mergeAdjacentHits", () => {
  it("does not merge ranges with a gap", () => {
    const out = mergeAdjacentHits([h("a.js", 1, 50), h("a.js", 60, 100)]);
    expect(out).toHaveLength(2);
    expect(out.every((x) => x.mergedFrom === 1)).toBe(true);
  });

  it("merges overlapping ranges, each line once", () => {
    const [m, ...rest] = mergeAdjacentHits([
      h("a.js", 1, 50),
      h("a.js", 41, 90),
    ]);
    expect(rest).toHaveLength(0);
    expect(range(m)).toEqual([1, 90]);
    expect(m.text).toBe(lines(1, 90));
    expect(m.mergedFrom).toBe(2);
  });

  it("merges touching ranges", () => {
    const [m] = mergeAdjacentHits([h("a.js", 1, 50), h("a.js", 51, 100)]);
    expect(range(m)).toEqual([1, 100]);
    expect(m.text).toBe(lines(1, 100));
  });

  it("merges three chained hits regardless of input order", () => {
    const input = [h("a.js", 81, 120), h("a.js", 1, 50), h("a.js", 41, 90)];
    const out = mergeAdjacentHits(input);
    expect(out).toHaveLength(1);
    expect(range(out[0])).toEqual([1, 120]);
    expect(out[0].text).toBe(lines(1, 120));
    expect(out[0].mergedFrom).toBe(3);
  });

  it("does not merge different files", () => {
    const out = mergeAdjacentHits([h("a.js", 1, 50), h("b.js", 1, 50)]);
    expect(out).toHaveLength(2);
  });

  it("merged score is the maximum", () => {
    const [m] = mergeAdjacentHits([
      h("a.js", 1, 50, 0.6),
      h("a.js", 41, 90, 0.9),
    ]);
    expect(m.score).toBe(0.9);
  });

  it("merged text has no duplicated lines", () => {
    const [m] = mergeAdjacentHits([
      h("a.js", 1, 50),
      h("a.js", 41, 90),
      h("a.js", 81, 95),
    ]);
    const ls = m.text.split("\n");
    expect(new Set(ls).size).toBe(ls.length);
    expect(ls).toHaveLength(95);
  });

  it("orders by score descending and applies the limit", () => {
    const input = [
      h("a.js", 1, 10, 0.5),
      h("b.js", 1, 10, 0.9),
      h("c.js", 1, 10, 0.7),
    ];
    expect(mergeAdjacentHits(input).map((x) => x.path)).toEqual([
      "b.js",
      "c.js",
      "a.js",
    ]);
    expect(mergeAdjacentHits(input, { limit: 2 }).map((x) => x.path)).toEqual([
      "b.js",
      "c.js",
    ]);
  });

  it("long-line segments (same line number) are never merged, neighbours stay separate", () => {
    const seg = (t, s) => ({
      path: "a.js",
      startLine: 4,
      endLine: 4,
      text: t,
      score: s,
    });
    const out = mergeAdjacentHits(
      [
        h("a.js", 1, 3, 0.4),
        seg("X".repeat(10), 0.9),
        seg("Y".repeat(10), 0.8),
        seg("Z".repeat(5), 0.7),
        h("a.js", 5, 5, 0.3),
      ],
      { limit: 10 },
    );
    expect(out).toHaveLength(5);
    expect(out.every((x) => x.mergedFrom === 1)).toBe(true);
    expect(out.filter((x) => x.startLine === 4).map((x) => x.text)).toEqual([
      "X".repeat(10),
      "Y".repeat(10),
      "Z".repeat(5),
    ]);
  });

  it("skips a merge that would exceed maxChars, but still absorbs contained hits", () => {
    const big = mergeAdjacentHits([h("a.js", 1, 10), h("a.js", 6, 15)], {
      maxChars: 40,
    });
    expect(big).toHaveLength(2);
    const contained = mergeAdjacentHits([h("a.js", 1, 10), h("a.js", 3, 5)], {
      maxChars: 30,
    });
    expect(contained).toHaveLength(1);
    expect(contained[0].mergedFrom).toBe(2);
  });
});

describe("retrieve", () => {
  const REPO = "a1".repeat(12);
  beforeEach(() => {
    embedQuery.mockReset();
    Chunk.aggregate.mockReset();
    embedQuery.mockResolvedValue([0.1, 0.2]);
    Chunk.aggregate.mockResolvedValue([
      h("a.js", 1, 50, 0.8),
      h("a.js", 41, 90, 0.7),
    ]);
  });

  it("puts the repoId filter inside $vectorSearch and never projects the embedding", async () => {
    const out = await retrieve({ repoId: REPO, query: "where is auth" });
    expect(embedQuery).toHaveBeenCalledWith("where is auth");
    const pipeline = Chunk.aggregate.mock.calls[0][0];
    const vs = pipeline[0].$vectorSearch;
    expect(vs).toMatchObject({
      index: "chunks_vector",
      path: "embedding",
      queryVector: [0.1, 0.2],
      numCandidates: NUM_CANDIDATES,
      limit: CANDIDATE_LIMIT,
    });
    expect(vs.filter.repoId.$eq).toBeInstanceOf(mongoose.Types.ObjectId);
    expect(String(vs.filter.repoId.$eq)).toBe(REPO);
    expect(pipeline.some((s) => s.$unset === "embedding")).toBe(true);
    expect(JSON.stringify(pipeline.find((s) => s.$project))).not.toContain(
      '"embedding"',
    );
    expect(out).toHaveLength(1);
    expect(range(out[0])).toEqual([1, 90]);
  });
});

describe("retrieveByVector", () => {
  const REPO_ID = "a1".repeat(12);
  beforeEach(() => {
    embedQuery.mockReset();
    Chunk.aggregate.mockReset();
    Chunk.aggregate.mockResolvedValue([
      h("a.js", 1, 50, 0.8),
      h("a.js", 41, 90, 0.7),
      h("b.js", 1, 10, 0.6),
    ]);
  });

  it("merge on merges adjacent hits and never embeds", async () => {
    const out = await retrieveByVector({ repoId: REPO_ID, queryVector: [0.1] });
    expect(out.map((x) => x.path)).toEqual(["a.js", "b.js"]);
    expect(range(out[0])).toEqual([1, 90]);
    expect(embedQuery).not.toHaveBeenCalled();
  });

  it("merge off returns raw hits in score order, cut to the limit", async () => {
    const out = await retrieveByVector({
      repoId: REPO_ID,
      queryVector: [0.1],
      merge: false,
      limit: 2,
    });
    expect(out.map((x) => [x.path, ...range(x)])).toEqual([
      ["a.js", 1, 50],
      ["a.js", 41, 90],
    ]);
    expect(out.every((x) => x.mergedFrom === 1)).toBe(true);
  });
});
