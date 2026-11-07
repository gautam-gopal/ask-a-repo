// Pure helpers for the retrieval eval (Phase 10A). No I/O, no network, no config import.
import { createHash } from "node:crypto";

export const KINDS = [
  "exact-identifier",
  "conceptual",
  "multi-file",
  "overview",
  "off-topic",
  "test-targeted",
];
// Headline on-topic kinds. test-targeted is reported separately (D-090).
export const ON_TOPIC_KINDS = KINDS.filter(
  (k) => k !== "off-topic" && k !== "test-targeted",
);
export const REPORT_KINDS = [...ON_TOPIC_KINDS, "test-targeted"];
export const TOP_K = 5;
export const CHARS_PER_TOKEN = 4; // ESTIMATE, same as the rest of the project
export const TOKEN_LIMIT = 512;

const ID_RE = /^[A-Za-z0-9._-]{1,40}$/;
const LABEL_RE = /^[A-Za-z0-9._-]{1,60}$/;
const SHA_RE = /^[0-9a-f]{40}$/;

// ---- questions.json ----
// Returns a list of problems (empty = valid). Does not touch the network.
export function validateQuestions(data) {
  const errors = [];
  const err = (m) => errors.push(m);
  if (!data || typeof data !== "object" || Array.isArray(data))
    return ["the file must be an object { repos, questions }"];

  const repoIds = new Set();
  if (!Array.isArray(data.repos) || data.repos.length === 0)
    err("repos must be a non-empty array");
  else
    data.repos.forEach((r, i) => {
      const at = `repos[${i}]`;
      if (!r || typeof r !== "object" || Array.isArray(r))
        return err(`${at} must be an object`);
      if (typeof r.id !== "string" || !ID_RE.test(r.id))
        err(`${at}.id must match ${ID_RE}`);
      else if (repoIds.has(r.id)) err(`${at}.id "${r.id}" is duplicated`);
      else repoIds.add(r.id);
      if (typeof r.url !== "string" || r.url.trim() === "")
        err(`${at}.url must be a non-empty string`);
      if (
        r.sha !== undefined &&
        !(typeof r.sha === "string" && SHA_RE.test(r.sha))
      )
        err(
          `${at}.sha, when present, must be a 40-character lowercase hex commit sha`,
        );
    });

  const qIds = new Set();
  if (!Array.isArray(data.questions) || data.questions.length === 0)
    err("questions must be a non-empty array");
  else
    data.questions.forEach((q, i) => {
      const at = `questions[${i}]`;
      if (!q || typeof q !== "object" || Array.isArray(q))
        return err(`${at} must be an object`);
      if (typeof q.id !== "string" || !ID_RE.test(q.id))
        err(`${at}.id must match ${ID_RE}`);
      else if (qIds.has(q.id)) err(`${at}.id "${q.id}" is duplicated`);
      else qIds.add(q.id);
      if (!repoIds.has(q.repoId))
        err(`${at}.repoId "${q.repoId}" is not in repos`);
      if (
        typeof q.question !== "string" ||
        q.question.trim() === "" ||
        q.question.trim().length > 500
      )
        err(`${at}.question must be 1 to 500 characters`);
      if (!KINDS.includes(q.kind))
        err(`${at}.kind must be one of ${KINDS.join(", ")}`);
      if (
        !Array.isArray(q.expectedPaths) ||
        !q.expectedPaths.every((p) => typeof p === "string" && p !== "")
      )
        err(`${at}.expectedPaths must be an array of non-empty strings`);
      else if (q.kind === "off-topic" && q.expectedPaths.length > 0)
        err(`${at} is off-topic, so expectedPaths must be empty`);
      else if (
        KINDS.includes(q.kind) &&
        q.kind !== "off-topic" &&
        q.expectedPaths.length === 0
      )
        err(`${at} (${q.kind}) needs at least one expected path`);
    });
  return errors;
}

// filesByRepoId: Map(repoId -> Set of indexable paths). A typo in an expected path would
// silently become a miss, so every expected path must exist in the snapshot.
export function checkExpectedPaths(data, filesByRepoId) {
  const errors = [];
  for (const q of data.questions) {
    const files = filesByRepoId.get(q.repoId);
    if (!files) continue;
    for (const p of q.expectedPaths)
      if (!files.has(p))
        errors.push(
          `question "${q.id}": expected path "${p}" is not an indexable file in repo "${q.repoId}"`,
        );
  }
  return errors;
}

// ---- config / flags ----
export const DEFAULTS = Object.freeze({
  window: 50,
  overlap: 10,
  maxChars: 1500,
  prefix: true,
  queryPrefix: false,
  merge: true,
  excludeTests: false,
  label: null,
  yes: false,
});

const FLAGS = {
  "--window": "window",
  "--overlap": "overlap",
  "--max-chars": "maxChars",
  "--prefix": "prefix",
  "--query-prefix": "queryPrefix",
  "--merge": "merge",
  "--exclude-tests": "excludeTests",
  "--label": "label",
};
const BOOL_KEYS = new Set(["prefix", "queryPrefix", "merge", "excludeTests"]);

// The default label is unchanged; only an exclude-tests run gets the -x1 suffix.
export const autoLabel = (c) =>
  `w${c.window}-o${c.overlap}-c${c.maxChars}-p${c.prefix ? 1 : 0}-q${c.queryPrefix ? 1 : 0}-m${c.merge ? 1 : 0}${c.excludeTests ? "-x1" : ""}`;

export function parseConfig(argv, defaults = DEFAULTS) {
  const cfg = { ...defaults };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--yes") {
      cfg.yes = true;
      continue;
    }
    const key = FLAGS[a];
    if (!key) throw new RangeError(`Unknown argument: ${a}`);
    const v = argv[++i];
    if (v === undefined) throw new RangeError(`${a} needs a value`);
    if (BOOL_KEYS.has(key)) {
      if (v !== "on" && v !== "off")
        throw new RangeError(`${a} must be "on" or "off"`);
      cfg[key] = v === "on";
    } else if (key === "label") {
      if (!LABEL_RE.test(v))
        throw new RangeError(
          "--label may only use letters, digits, . _ - (max 60)",
        );
      cfg.label = v;
    } else {
      if (!/^\d+$/.test(v)) throw new RangeError(`${a} must be a whole number`);
      cfg[key] = Number(v);
    }
  }
  if (cfg.window < 1) throw new RangeError("--window must be at least 1");
  if (cfg.overlap >= cfg.window)
    throw new RangeError("--overlap must be less than --window");
  if (cfg.maxChars < 1) throw new RangeError("--max-chars must be at least 1");
  if (!cfg.label) cfg.label = autoLabel(cfg);
  return Object.freeze(cfg);
}

// ---- embedding cache ----
// Key = sha256 of the model, dimensions and the exact text sent to the model.
export const cacheKey = (text, model, dims) =>
  createHash("sha256")
    .update(JSON.stringify([model, dims, text]))
    .digest("hex");

// ---- metrics (file level) ----
// 1-based position of the first result whose path is expected, or null.
export function rankOf(paths, expectedPaths) {
  const i = paths.findIndex((p) => expectedPaths.includes(p));
  return i === -1 ? null : i + 1;
}

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

// rows: [{ rank: number|null }]. MRR counts only the returned top results (rank null = 0).
export function groupMetrics(rows) {
  const n = rows.length;
  const frac = (k) =>
    n ? rows.filter((r) => r.rank !== null && r.rank <= k).length / n : null;
  return {
    n,
    hit1: frac(1),
    hit3: frac(3),
    hit5: frac(5),
    mrr: n ? rows.reduce((s, r) => s + (r.rank ? 1 / r.rank : 0), 0) / n : null,
    avgRank: mean(rows.filter((r) => r.rank !== null).map((r) => r.rank)),
  };
}

const quantile = (sorted, p) => {
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};

export function scoreStats(scores) {
  const s = scores.filter(Number.isFinite).sort((a, b) => a - b); // null and NaN are ignored
  if (!s.length) return null;
  return {
    n: s.length,
    min: s[0],
    p25: quantile(s, 0.25),
    median: quantile(s, 0.5),
    p75: quantile(s, 0.75),
    max: s[s.length - 1],
  };
}

// results: [{ kind, rank, topScore }]. Hit metrics cover on-topic questions only.
export function computeMetrics(results) {
  const on = results.filter((r) => ON_TOPIC_KINDS.includes(r.kind));
  const off = results.filter((r) => r.kind === "off-topic");
  const byKind = {};
  for (const k of REPORT_KINDS)
    byKind[k] = groupMetrics(results.filter((r) => r.kind === k));
  return {
    overall: groupMetrics(on),
    byKind,
    onTopicScores: scoreStats(on.map((r) => r.topScore)),
    offTopicScores: scoreStats(off.map((r) => r.topScore)),
  };
}

// chunks: [{ text, embedText }] where embedText is what is actually embedded.
// The 512-token check is an ESTIMATE (chars / 4); dense code tokenizes denser.
export function chunkStats(chunks) {
  const n = chunks.length;
  if (!n)
    return {
      chunks: 0,
      avgChars: 0,
      maxChars: 0,
      over512Count: 0,
      over512Frac: 0,
    };
  const lens = chunks.map((c) => c.text.length);
  const over = chunks.filter(
    (c) => c.embedText.length / CHARS_PER_TOKEN > TOKEN_LIMIT,
  ).length;
  return {
    chunks: n,
    avgChars: Math.round((lens.reduce((s, x) => s + x, 0) / n) * 10) / 10,
    maxChars: Math.max(...lens),
    over512Count: over,
    over512Frac: over / n,
  };
}

// ---- csv ----
export const CSV_COLUMNS = [
  "label",
  "date",
  "window",
  "overlap",
  "max_chars",
  "prefix",
  "query_prefix",
  "merge",
  "questions",
  "chunks",
  "avg_chars",
  "max_chunk_chars",
  "over512_frac",
  "hit1",
  "hit3",
  "hit5",
  "mrr",
  "avg_rank",
  "hit5_exact",
  "hit5_conceptual",
  "hit5_multi",
  "off_top_median",
  "off_top_max",
  "on_top_min",
  "on_top_median",
  "neurons_used",
  "cache_hits",
  "cache_misses",
];
export const csvHeader = () => CSV_COLUMNS.join(",");
export function csvRow(rec) {
  return CSV_COLUMNS.map((c) => {
    const v = rec[c];
    if (v === null || v === undefined) return "";
    const s =
      typeof v === "number" ? String(Math.round(v * 1e4) / 1e4) : String(v);
    if (/[",\n]/.test(s)) throw new Error(`CSV value for ${c} needs quoting`);
    return s;
  }).join(",");
}

export const pct = (x) =>
  x === null || x === undefined ? "-" : `${(x * 100).toFixed(1)}%`;
export const fix = (x, d = 3) =>
  x === null || x === undefined ? "-" : x.toFixed(d);

export { isTestPath } from "../src/services/testPaths.js"; // shared with production ingest

// ---- threshold sweep (D-083) ----
// results: [{ kind, topScore }]. A question PASSES a threshold when topScore >= t, which is
// the rule in answer.js (best score below SEARCH_MIN_SCORE means notFound).
export function sweepThresholds(
  results,
  { from = 0.7, to = 0.9, step = 0.005 } = {},
) {
  const on = results.filter((r) => ON_TOPIC_KINDS.includes(r.kind));
  const off = results.filter((r) => r.kind === "off-topic");
  const ov = results.filter((r) => r.kind === "overview");
  const rows = [];
  const steps = Math.round((to - from) / step);
  for (let i = 0; i <= steps; i++) {
    const t = Math.round((from + i * step) * 1000) / 1000;
    const pass = (rs) =>
      rs.filter((r) => Number.isFinite(r.topScore) && r.topScore >= t).length;
    rows.push({
      t,
      onN: on.length,
      onPass: pass(on),
      offN: off.length,
      offRejected: off.length - pass(off),
      ovN: ov.length,
      ovPass: pass(ov),
    });
  }
  return rows;
}

// Rejections only grow as t rises, so "highest t with at most N on-topic rejections" is well defined.
export function thresholdMarkers(rows) {
  const highest = (max) => {
    let best = null;
    for (const r of rows) if (r.onN - r.onPass <= max) best = r.t;
    return best;
  };
  return { zero: highest(0), atMostOne: highest(1) };
}

// ---- per-question result row (regression: topScore went missing from the JSON and the stats) ----
export const finiteOrNull = (x) =>
  typeof x === "number" && Number.isFinite(x) ? x : null;

// The only place a result row is built. hits: [{ path, startLine, endLine, score }] best first.
// topScore is the first hit's score, or null when there are no hits (never 0, never NaN).
export function makeResultRow(q, hits, topK = TOP_K) {
  return {
    id: q.id,
    repoId: q.repoId,
    kind: q.kind,
    question: q.question.trim(),
    expectedPaths: q.expectedPaths,
    rank: rankOf(
      hits.map((h) => h.path),
      q.expectedPaths,
    ),
    topScore: finiteOrNull(hits[0]?.score),
    top: hits.slice(0, topK).map((h) => ({
      path: h.path,
      lines: `${h.startLine}-${h.endLine}`,
      score: h.score,
    })),
  };
}

// Returns problems (empty = fine). Run before any report is written.
export function checkResultRows(rows) {
  const errors = [];
  for (const r of rows) {
    if (!("topScore" in r)) errors.push(`${r.id}: topScore is missing`);
    else if (r.topScore !== null && !Number.isFinite(r.topScore))
      errors.push(`${r.id}: topScore is not a finite number`);
    else if ((r.top?.length ?? 0) === 0 && r.topScore !== null)
      errors.push(`${r.id}: no hits but topScore is set`);
    else if (r.top?.length > 0 && r.topScore !== r.top[0].score)
      errors.push(`${r.id}: topScore differs from top[0].score`);
  }
  return errors;
}
