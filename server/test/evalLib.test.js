import { describe, it, expect } from "vitest";
import {
  validateQuestions,
  checkExpectedPaths,
  parseConfig,
  cacheKey,
  rankOf,
  groupMetrics,
  computeMetrics,
  scoreStats,
  chunkStats,
  csvHeader,
  csvRow,
  CSV_COLUMNS,
  isTestPath,
  sweepThresholds,
  thresholdMarkers,
  makeResultRow,
  checkResultRows,
} from "../eval/lib.js";

const SHA = "a".repeat(40);
const valid = () => ({
  repos: [{ id: "r1", url: "https://github.com/o/r" }],
  questions: [
    {
      id: "q1",
      repoId: "r1",
      question: "where is auth",
      expectedPaths: ["a.js"],
      kind: "exact-identifier",
    },
    {
      id: "q2",
      repoId: "r1",
      question: "how does x work",
      expectedPaths: ["a.js", "b.js"],
      kind: "multi-file",
    },
    {
      id: "q3",
      repoId: "r1",
      question: "pasta recipe",
      expectedPaths: [],
      kind: "off-topic",
    },
  ],
});

describe("validateQuestions", () => {
  it("accepts a valid file, including an optional sha", () => {
    expect(validateQuestions(valid())).toEqual([]);
    const d = valid();
    d.repos[0].sha = SHA;
    expect(validateQuestions(d)).toEqual([]);
  });

  it.each([
    ["not an object", () => [], /object/],
    [
      "no repos",
      (d) => {
        d.repos = [];
      },
      /repos/,
    ],
    [
      "duplicate repo id",
      (d) => {
        d.repos.push({ id: "r1", url: "u" });
      },
      /duplicated/,
    ],
    [
      "bad sha",
      (d) => {
        d.repos[0].sha = "abc";
      },
      /sha/,
    ],
    [
      "no questions",
      (d) => {
        d.questions = [];
      },
      /questions/,
    ],
    [
      "duplicate question id",
      (d) => {
        d.questions[1].id = "q1";
      },
      /duplicated/,
    ],
    [
      "unknown repoId",
      (d) => {
        d.questions[0].repoId = "nope";
      },
      /not in repos/,
    ],
    [
      "bad kind",
      (d) => {
        d.questions[0].kind = "easy";
      },
      /kind/,
    ],
    [
      "blank question",
      (d) => {
        d.questions[0].question = "   ";
      },
      /question/,
    ],
    [
      "question over 500",
      (d) => {
        d.questions[0].question = "x".repeat(501);
      },
      /question/,
    ],
    [
      "empty expected on-topic",
      (d) => {
        d.questions[0].expectedPaths = [];
      },
      /at least one/,
    ],
    [
      "expected on off-topic",
      (d) => {
        d.questions[2].expectedPaths = ["a.js"];
      },
      /must be empty/,
    ],
    [
      "non-string path",
      (d) => {
        d.questions[0].expectedPaths = [5];
      },
      /expectedPaths/,
    ],
  ])("rejects %s", (_n, mutate, re) => {
    const d = structuredClone(valid());
    const out = mutate(d);
    const errors = validateQuestions(Array.isArray(out) ? out : d);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join("\n")).toMatch(re);
  });
});

describe("checkExpectedPaths", () => {
  it("flags paths missing from the snapshot", () => {
    const files = new Map([["r1", new Set(["a.js"])]]);
    const errors = checkExpectedPaths(valid(), files);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/"b\.js"/);
  });
  it("passes when every path exists", () => {
    const files = new Map([["r1", new Set(["a.js", "b.js"])]]);
    expect(checkExpectedPaths(valid(), files)).toEqual([]);
  });
});

describe("parseConfig", () => {
  it("uses the defaults and an automatic label", () => {
    const c = parseConfig([]);
    expect(c).toMatchObject({
      window: 50,
      overlap: 10,
      maxChars: 1500,
      prefix: true,
      queryPrefix: false,
      merge: true,
      yes: false,
    });
    expect(c.label).toBe("w50-o10-c1500-p1-q0-m1");
  });
  it("reads every flag", () => {
    const c = parseConfig([
      "--window",
      "30",
      "--overlap",
      "5",
      "--max-chars",
      "1000",
      "--prefix",
      "off",
      "--query-prefix",
      "on",
      "--merge",
      "off",
      "--label",
      "x1.a",
      "--yes",
    ]);
    expect(c).toMatchObject({
      window: 30,
      overlap: 5,
      maxChars: 1000,
      prefix: false,
      queryPrefix: true,
      merge: false,
      label: "x1.a",
      yes: true,
    });
  });
  it("takes defaults from the caller (query prefix comes from config)", () => {
    expect(
      parseConfig([], { ...parseConfig([]), queryPrefix: true }).queryPrefix,
    ).toBe(true);
  });
  it.each([
    [["--bogus", "1"]],
    [["--window"]],
    [["--window", "0"]],
    [["--window", "abc"]],
    [["--window", "1.5"]],
    [["--window", "10"]], // default overlap 10 is not less than 10
    [["--overlap", "50"]],
    [["--max-chars", "0"]],
    [["--prefix", "maybe"]],
    [["--label", "../evil"]],
    [["--label", ""]],
  ])("throws on %j", (argv) => {
    expect(() => parseConfig(argv)).toThrow(RangeError);
  });
});

describe("cacheKey", () => {
  it("is a stable sha256 hex string", () => {
    const k = cacheKey("hello", "m", 768);
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(cacheKey("hello", "m", 768)).toBe(k);
  });
  it("changes with the text, the model and the dimensions", () => {
    const k = cacheKey("hello", "m", 768);
    expect(cacheKey("hello!", "m", 768)).not.toBe(k);
    expect(cacheKey("hello", "m2", 768)).not.toBe(k);
    expect(cacheKey("hello", "m", 384)).not.toBe(k);
  });
  it("does not confuse field boundaries", () => {
    expect(cacheKey("b", "a", 1)).not.toBe(cacheKey("", "ab", 1));
  });
});

describe("rankOf", () => {
  it("is 1-based and takes the first expected path", () => {
    expect(rankOf(["x", "b.js", "a.js"], ["a.js", "b.js"])).toBe(2);
    expect(rankOf(["a.js"], ["a.js"])).toBe(1);
  });
  it("is null with no match or no expectation", () => {
    expect(rankOf(["x", "y"], ["a.js"])).toBeNull();
    expect(rankOf(["x"], [])).toBeNull();
    expect(rankOf([], ["a.js"])).toBeNull();
  });
});

describe("metrics", () => {
  const results = [
    { kind: "conceptual", rank: 1, topScore: 0.8 },
    { kind: "conceptual", rank: 3, topScore: 0.7 },
    { kind: "exact-identifier", rank: null, topScore: 0.6 },
    { kind: "exact-identifier", rank: 5, topScore: 0.65 },
    { kind: "off-topic", rank: null, topScore: 0.5 },
    { kind: "off-topic", rank: null, topScore: 0.54 },
  ];

  it("computes hit@k, MRR and average rank over on-topic questions only", () => {
    const { overall } = computeMetrics(results);
    expect(overall.n).toBe(4);
    expect(overall.hit1).toBeCloseTo(0.25);
    expect(overall.hit3).toBeCloseTo(0.5);
    expect(overall.hit5).toBeCloseTo(0.75);
    expect(overall.mrr).toBeCloseTo((1 + 1 / 3 + 0 + 1 / 5) / 4);
    expect(overall.avgRank).toBeCloseTo(3);
  });

  it("splits by kind", () => {
    const { byKind } = computeMetrics(results);
    expect(byKind.conceptual).toMatchObject({
      n: 2,
      hit1: 0.5,
      hit3: 1,
      hit5: 1,
    });
    expect(byKind.conceptual.mrr).toBeCloseTo((1 + 1 / 3) / 2);
    expect(byKind.conceptual.avgRank).toBeCloseTo(2);
    expect(byKind["exact-identifier"].hit5).toBeCloseTo(0.5);
    expect(byKind["multi-file"]).toMatchObject({
      n: 0,
      hit5: null,
      mrr: null,
      avgRank: null,
    });
  });

  it("summarises off-topic and on-topic top scores", () => {
    const m = computeMetrics(results);
    expect(m.offTopicScores).toMatchObject({ n: 2, min: 0.5, max: 0.54 });
    expect(m.offTopicScores.median).toBeCloseTo(0.52);
    expect(m.onTopicScores.min).toBeCloseTo(0.6);
  });

  it("handles no rows and no hits", () => {
    expect(groupMetrics([])).toMatchObject({ n: 0, hit5: null, mrr: null });
    expect(groupMetrics([{ rank: null }]).avgRank).toBeNull();
    expect(computeMetrics([]).offTopicScores).toBeNull();
  });

  it("scoreStats interpolates quantiles", () => {
    expect(scoreStats([5, 1, 3, 2, 4])).toEqual({
      n: 5,
      min: 1,
      p25: 2,
      median: 3,
      p75: 4,
      max: 5,
    });
    expect(scoreStats([7])).toMatchObject({ median: 7, min: 7, max: 7 });
  });
});

describe("chunkStats", () => {
  it("counts chunks over the estimated 512-token limit (chars / 4, strictly greater)", () => {
    const s = chunkStats([
      { text: "ab", embedText: "x".repeat(2049) },
      { text: "abcd", embedText: "y".repeat(2048) },
    ]);
    expect(s).toEqual({
      chunks: 2,
      avgChars: 3,
      maxChars: 4,
      over512Count: 1,
      over512Frac: 0.5,
    });
  });
  it("handles no chunks", () => {
    expect(chunkStats([]).chunks).toBe(0);
  });
});

describe("csv", () => {
  it("writes one value per column, empty for missing", () => {
    const row = csvRow({ label: "a", hit5: 0.123456, window: 50 }).split(",");
    expect(row).toHaveLength(CSV_COLUMNS.length);
    expect(row[CSV_COLUMNS.indexOf("hit5")]).toBe("0.1235");
    expect(row[CSV_COLUMNS.indexOf("mrr")]).toBe("");
    expect(csvHeader().split(",")).toEqual(CSV_COLUMNS);
  });
  it("refuses values that would need quoting", () => {
    expect(() => csvRow({ label: "a,b" })).toThrow();
  });
});

describe("overview kind", () => {
  it("validates like the other on-topic kinds", () => {
    const d = valid();
    d.questions.push({
      id: "q4",
      repoId: "r1",
      question: "what does this project do?",
      expectedPaths: ["README.md"],
      kind: "overview",
    });
    expect(validateQuestions(d)).toEqual([]);
    d.questions[3].expectedPaths = [];
    expect(validateQuestions(d).join("\n")).toMatch(/at least one/);
  });
  it("is on-topic with its own metrics group", () => {
    const m = computeMetrics([
      { kind: "overview", rank: 2, topScore: 0.8 },
      { kind: "off-topic", rank: null, topScore: 0.7 },
    ]);
    expect(m.overall.n).toBe(1);
    expect(m.byKind.overview).toMatchObject({ n: 1, hit5: 1, hit1: 0 });
  });
});

describe("isTestPath", () => {
  it.each([
    ["server/test/a.js", true],
    ["backend/tests/domain/x.js", true],
    ["test/a.js", true],
    ["src/__tests__/a.js", true],
    ["src/a.test.js", true],
    ["src/a.spec.tsx", true],
    ["src/A.TEST.JS", true],
    ["src/latest/a.js", false],
    ["src/contest.js", false],
    ["src/a.test.json", false],
    ["src/testing.js", false],
    ["server/src/services/github.js", false],
  ])("%s -> %s", (p, expected) => expect(isTestPath(p)).toBe(expected));
});

describe("--exclude-tests", () => {
  it("defaults to off and keeps the default label", () => {
    const c = parseConfig([]);
    expect(c.excludeTests).toBe(false);
    expect(c.label).toBe("w50-o10-c1500-p1-q0-m1");
  });
  it("turns on and adds -x1 to the label", () => {
    const c = parseConfig(["--exclude-tests", "on"]);
    expect(c.excludeTests).toBe(true);
    expect(c.label).toBe("w50-o10-c1500-p1-q0-m1-x1");
    expect(() => parseConfig(["--exclude-tests", "maybe"])).toThrow(RangeError);
  });
});

describe("threshold sweep", () => {
  const rs = [
    { kind: "conceptual", topScore: 0.85 },
    { kind: "conceptual", topScore: 0.82 },
    { kind: "overview", topScore: 0.81 },
    { kind: "off-topic", topScore: 0.78 },
    { kind: "off-topic", topScore: 0.83 },
  ];
  const rows = sweepThresholds(rs);

  it("covers 0.70 to 0.90 in 0.005 steps", () => {
    expect(rows).toHaveLength(41);
    expect(rows[0].t).toBe(0.7);
    expect(rows.at(-1).t).toBe(0.9);
  });
  it("counts passes, off-topic rejections and the overview kind", () => {
    expect(rows.find((r) => r.t === 0.8)).toMatchObject({
      onN: 3,
      onPass: 3,
      offN: 2,
      offRejected: 1,
      ovN: 1,
      ovPass: 1,
    });
    expect(rows.find((r) => r.t === 0.815)).toMatchObject({
      onPass: 2,
      ovPass: 0,
    });
  });
  it("finds the highest threshold with 0 and with at most 1 on-topic rejection", () => {
    expect(thresholdMarkers(rows)).toEqual({ zero: 0.81, atMostOne: 0.82 });
  });
  it("returns null when even 0.70 rejects too much", () => {
    const low = sweepThresholds([{ kind: "conceptual", topScore: 0.5 }]);
    expect(thresholdMarkers(low)).toEqual({ zero: null, atMostOne: 0.9 });
  });
});

describe("result rows (topScore regression)", () => {
  const q = {
    id: "q1",
    repoId: "r1",
    question: "  where is auth  ",
    expectedPaths: ["b.js"],
    kind: "conceptual",
  };
  const hit = (path, score) => ({ path, startLine: 1, endLine: 9, score });

  it("topScore is the first hit's score and matches top[0].score", () => {
    const row = makeResultRow(q, [hit("a.js", 0.889429), hit("b.js", 0.8)]);
    expect(row.topScore).toBe(0.889429);
    expect(row.topScore).toBe(row.top[0].score);
    expect(row.rank).toBe(2);
    expect(row.question).toBe("where is auth");
    expect(row.top[0]).toEqual({ path: "a.js", lines: "1-9", score: 0.889429 });
  });

  it("keeps at most 5 hits in top", () => {
    const hits = Array.from({ length: 8 }, (_, i) =>
      hit(`f${i}.js`, 0.9 - i / 100),
    );
    expect(makeResultRow(q, hits).top).toHaveLength(5);
  });

  it("no hits: topScore is null (not 0, not NaN), rank null", () => {
    const row = makeResultRow(q, []);
    expect(row.topScore).toBeNull();
    expect(row.top).toEqual([]);
    expect(row.rank).toBeNull();
    expect(checkResultRows([row])).toEqual([]);
  });

  it("a non-finite score becomes null", () => {
    expect(makeResultRow(q, [hit("a.js", NaN)]).topScore).toBeNull();
  });

  it("survives a JSON round trip with topScore present", () => {
    const row = JSON.parse(
      JSON.stringify(makeResultRow(q, [hit("a.js", 0.85)])),
    );
    expect(row).toHaveProperty("topScore", 0.85);
  });

  it("checkResultRows catches a missing or inconsistent topScore", () => {
    const good = makeResultRow(q, [hit("a.js", 0.85)]);
    const { topScore: _drop, ...missing } = good;
    expect(checkResultRows([missing]).join()).toMatch(/missing/);
    expect(checkResultRows([{ ...good, topScore: 0.5 }]).join()).toMatch(
      /differs/,
    );
    expect(checkResultRows([{ ...good, topScore: NaN }]).join()).toMatch(
      /finite/,
    );
    expect(
      checkResultRows([{ ...makeResultRow(q, []), topScore: 0 }]).join(),
    ).toMatch(/no hits/);
    expect(checkResultRows([good])).toEqual([]);
  });

  it("stats and the sweep ignore null scores without NaN", () => {
    const rows = [
      { kind: "conceptual", rank: 1, topScore: 0.85 },
      { kind: "conceptual", rank: null, topScore: null },
      { kind: "off-topic", rank: null, topScore: null },
      { kind: "off-topic", rank: null, topScore: 0.78 },
    ];
    const m = computeMetrics(rows);
    expect(m.onTopicScores).toMatchObject({ n: 1, min: 0.85, max: 0.85 });
    expect(m.offTopicScores).toMatchObject({ n: 1, median: 0.78 });
    expect(scoreStats([null, NaN, undefined])).toBeNull();
    const row = sweepThresholds(rows).find((r) => r.t === 0.7);
    expect(row).toMatchObject({ onN: 2, onPass: 1, offN: 2, offRejected: 1 });
    expect(JSON.stringify(sweepThresholds(rows))).not.toContain('null,"t"');
    for (const r of sweepThresholds(rows))
      for (const v of Object.values(r)) expect(Number.isNaN(v)).toBe(false);
  });
});
