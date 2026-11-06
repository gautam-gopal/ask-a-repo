// Retrieval-only evaluation (Phase 10A). No LLM, no routes.
//   node server/scripts/eval.js [--window N] [--overlap M] [--max-chars C] [--prefix on|off]
//        [--query-prefix on|off] [--merge on|off] [--exclude-tests on|off] [--label NAME] [--yes]
// Without --yes it only prints the estimate. Metric: FILE-level hit (see D-078).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { config } from "../src/config.js";
import {
  parseRepoUrl,
  resolveRepo,
  fetchTree,
  filterTree,
  fetchFileContents,
  GithubError,
} from "../src/services/github.js";
import { chunkRepo } from "../src/services/chunker.js";
import {
  embedDocuments,
  embedQuery,
  estimateUsage,
  getUsage,
  EmbeddingError,
  QUERY_PREFIX,
  DAILY_FREE_NEURONS,
} from "../src/services/embeddings.js";
import { Chunk } from "../src/models/Chunk.js";
import { buildPipeline, retrieveByVector } from "../src/services/retrieve.js";
import {
  DEFAULTS,
  ON_TOPIC_KINDS,
  TOP_K,
  parseConfig,
  validateQuestions,
  checkExpectedPaths,
  cacheKey,
  rankOf,
  computeMetrics,
  chunkStats,
  csvHeader,
  csvRow,
  pct,
  fix,
  isTestPath,
  makeResultRow,
  checkResultRows,
} from "../eval/lib.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const EVAL_DIR = path.resolve(here, "../eval");
const CACHE_DIR = path.join(EVAL_DIR, ".cache");
const QUESTIONS_FILE = path.join(EVAL_DIR, "questions.json");
const RUNS_DIR = path.join(EVAL_DIR, "runs");
const RESULTS_CSV = path.join(EVAL_DIR, "results.csv");

const DAY_MS = 24 * 60 * 60 * 1000;
const EMBED_SLICE = 64; // cache is written after every slice, so a crash loses at most one
const INSERT_SLICE = 100;
// Fixed throwaway user: everything the eval writes carries this userId, so cleanup is one delete.
const EVAL_USER_ID = new mongoose.Types.ObjectId("ea".repeat(12));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- repo snapshots (GitHub only; no neurons) ----
async function loadSnapshot(entry) {
  const { owner, repo } = parseRepoUrl(entry.url);
  const sha = entry.sha ?? (await resolveRepo({ owner, repo })).sha;
  const file = path.join(CACHE_DIR, "repos", `${owner}__${repo}__${sha}.json`);
  try {
    return { ...JSON.parse(fs.readFileSync(file, "utf8")), fromCache: true };
  } catch {
    // not cached yet
  }
  const tree = filterTree(await fetchTree(owner, repo, sha));
  const content = await fetchFileContents(owner, repo, sha, tree.files);
  const snap = { owner, repo, sha, files: content.files };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(snap));
  return { ...snap, fromCache: false };
}

// ---- embedding cache ----
const keyOf = (text) =>
  cacheKey(text, config.EMBEDDING_MODEL, config.EMBEDDING_DIMENSIONS);
const vecFile = (key) =>
  path.join(CACHE_DIR, "vectors", key.slice(0, 2), `${key}.json`);

function readVec(text) {
  try {
    const v = JSON.parse(fs.readFileSync(vecFile(keyOf(text)), "utf8"));
    return Array.isArray(v) && v.length === config.EMBEDDING_DIMENSIONS
      ? v
      : null;
  } catch {
    return null;
  }
}
function writeVec(text, vec) {
  const file = vecFile(keyOf(text));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(vec));
  fs.renameSync(tmp, file); // atomic: a crash never leaves a half-written entry
}
function loadCached(texts) {
  const map = new Map();
  for (const t of new Set(texts)) {
    const v = readVec(t);
    if (v) map.set(t, v);
  }
  return map;
}

function printTable(rows) {
  const widths = rows[0].map((_, c) =>
    Math.max(...rows.map((r) => String(r[c]).length)),
  );
  for (const r of rows)
    console.log(r.map((v, c) => String(v).padEnd(widths[c])).join("  "));
}

async function waitForIndex(repoOid, probes, vectors) {
  const deadline = Date.now() + 120_000;
  for (;;) {
    let ready = true;
    for (const p of probes) {
      const hits = await Chunk.aggregate(
        buildPipeline(repoOid, vectors.get(p.embedText)),
      );
      if (
        !hits.some(
          (h) =>
            h.path === p.path &&
            h.startLine === p.startLine &&
            h.endLine === p.endLine,
        )
      )
        ready = false;
    }
    if (ready) return;
    if (Date.now() > deadline)
      throw new Error(
        "The vector index did not return the new chunks within 120 s (still syncing, or index name/filter field wrong).",
      );
    await sleep(3000);
  }
}

async function main() {
  const cfg = parseConfig(process.argv.slice(2), {
    ...DEFAULTS,
    queryPrefix: config.QUERY_PREFIX_ENABLED,
  });
  const data = JSON.parse(fs.readFileSync(QUESTIONS_FILE, "utf8"));
  const problems = validateQuestions(data);
  if (problems.length) {
    console.error("Invalid server/eval/questions.json:");
    problems.forEach((p) => console.error(`  - ${p}`));
    process.exit(1);
  }

  // 1. Snapshots, chunks, texts. GitHub requests only.
  const snaps = new Map();
  for (const r of data.repos) {
    const s = await loadSnapshot(r);
    snaps.set(r.id, s);
    console.log(
      `Repo ${r.id}: ${s.owner}/${s.repo} @ ${s.sha}  ${s.files.length} files (${s.fromCache ? "snapshot cached" : "fetched"})`,
    );
  }
  const pathProblems = checkExpectedPaths(
    data,
    new Map(
      [...snaps].map(([id, s]) => [id, new Set(s.files.map((f) => f.path))]),
    ),
  );
  if (pathProblems.length) {
    console.error("Expected paths that do not exist:");
    pathProblems.forEach((p) => console.error(`  - ${p}`));
    process.exit(1);
  }

  if (cfg.excludeTests) {
    const bad = data.questions.flatMap((q) =>
      q.expectedPaths
        .filter(isTestPath)
        .map(
          (p) =>
            `question "${q.id}": expected path "${p}" is a test file and would be excluded`,
        ),
    );
    if (bad.length) {
      console.error("--exclude-tests conflicts with expected paths:");
      bad.forEach((p) => console.error(`  - ${p}`));
      process.exit(1);
    }
  }

  const perRepo = new Map();
  const allChunks = [];
  let droppedFiles = 0;
  for (const [id, s] of snaps) {
    const files = cfg.excludeTests
      ? s.files.filter((f) => !isTestPath(f.path))
      : s.files;
    droppedFiles += s.files.length - files.length;
    const { chunks } = chunkRepo(files, {
      windowLines: cfg.window,
      overlapLines: cfg.overlap,
      maxChunkChars: cfg.maxChars,
    });
    const mapped = chunks.map((c) => ({
      path: c.path,
      startLine: c.startLine,
      endLine: c.endLine,
      text: c.text,
      embedText: cfg.prefix ? c.embedText : c.text,
    }));
    perRepo.set(id, mapped);
    allChunks.push(...mapped);
  }
  const stats = chunkStats(allChunks);
  const questions = data.questions;
  const qText = (q) => q.question.trim();
  const qInput = (q) => (cfg.queryPrefix ? QUERY_PREFIX + qText(q) : qText(q));

  const docTexts = [...new Set(allChunks.map((c) => c.embedText))];
  const qInputs = [...new Set(questions.map(qInput))];
  const cached = loadCached([...docTexts, ...qInputs]);
  const missDocs = docTexts.filter((t) => !cached.has(t));
  const missQ = qInputs.filter((t) => !cached.has(t));
  const estMiss = {
    estTokens:
      estimateUsage(missDocs).estTokens + estimateUsage(missQ).estTokens,
    estNeurons:
      estimateUsage(missDocs).estNeurons + estimateUsage(missQ).estNeurons,
  };
  const estAll = estimateUsage([...docTexts, ...qInputs]);
  const cacheHits =
    docTexts.length - missDocs.length + qInputs.length - missQ.length;
  const cacheMisses = missDocs.length + missQ.length;

  console.log(`\nRun: ${cfg.label}`);
  console.log(
    `Settings: window ${cfg.window}, overlap ${cfg.overlap}, max-chars ${cfg.maxChars}, prefix ${cfg.prefix ? "on" : "off"}, query-prefix ${cfg.queryPrefix ? "on" : "off"}, merge ${cfg.merge ? "on" : "off"}, exclude-tests ${cfg.excludeTests ? "on" : "off"}`,
  );
  console.log(
    `Chunks: ${stats.chunks} (avg ${stats.avgChars} chars, max ${stats.maxChars}; est. ${pct(stats.over512Frac)} over 512 tokens, chars/4)`,
  );
  console.log(
    `To embed: ${missDocs.length} chunk texts + ${missQ.length} queries (cache: ${cacheHits} hits, ${cacheMisses} misses)`,
  );
  if (cfg.excludeTests)
    console.log(
      `Exclude-tests: dropped ${droppedFiles} files. Chunk texts are unchanged, so a run after a baseline should show 0 chunk misses (cache: ${cacheHits} hits, ${cacheMisses} misses).`,
    );
  console.log(
    `Estimated spend now: ~${estMiss.estTokens} tokens, ~${Math.round(estMiss.estNeurons * 10) / 10} neurons of ${DAILY_FREE_NEURONS}/day (estimate; chars/4 undercounts code)`,
  );
  console.log(
    `Without any cache it would be ~${Math.round(estAll.estNeurons * 10) / 10} neurons.`,
  );
  if (!cfg.yes) {
    console.log("\nNot started. Re-run with --yes.");
    return;
  }
  if (estMiss.estNeurons >= DAILY_FREE_NEURONS) {
    console.error(
      "Refusing: the estimate is at or above the daily free allowance. Use a smaller repo set or wait for the reset.",
    );
    process.exit(2);
  }
  if (estMiss.estNeurons >= DAILY_FREE_NEURONS * 0.6)
    console.warn(
      "Warning: over 60% of the daily allowance by estimate, and the estimate undercounts code.",
    );

  // 2. Embed everything missing, writing the cache after every slice. No database yet.
  for (let i = 0; i < missDocs.length; i += EMBED_SLICE) {
    const slice = missDocs.slice(i, i + EMBED_SLICE);
    const vecs = await embedDocuments(slice);
    slice.forEach((t, j) => {
      writeVec(t, vecs[j]);
      cached.set(t, vecs[j]);
    });
    console.log(
      `  embedded ${Math.min(i + EMBED_SLICE, missDocs.length)}/${missDocs.length} chunk texts`,
    );
  }
  for (const q of questions) {
    const input = qInput(q);
    if (cached.has(input)) continue;
    const vec = await embedQuery(qText(q), { queryPrefix: cfg.queryPrefix });
    writeVec(input, vec);
    cached.set(input, vec);
  }
  const neuronsUsed = getUsage().estNeurons;

  // 3. Throwaway chunks, real $vectorSearch, always cleaned up.
  const results = [];
  try {
    await mongoose.connect(config.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
    });
    await Chunk.init();
    await Chunk.deleteMany({ userId: EVAL_USER_ID }); // leftovers of a crashed run
    const expiresAt = new Date(Date.now() + DAY_MS);
    const repoIds = new Map();
    for (const [id, chunks] of perRepo) {
      const repoId = new mongoose.Types.ObjectId();
      repoIds.set(id, repoId);
      for (let i = 0; i < chunks.length; i += INSERT_SLICE)
        await Chunk.insertMany(
          chunks.slice(i, i + INSERT_SLICE).map((c) => ({
            repoId,
            userId: EVAL_USER_ID,
            path: c.path,
            startLine: c.startLine,
            endLine: c.endLine,
            text: c.text,
            embedding: cached.get(c.embedText),
            expiresAt,
          })),
          { ordered: false, throwOnValidationError: true },
        );
    }
    console.log("Inserted throwaway chunks; waiting for the vector index...");
    for (const [id, chunks] of perRepo) {
      if (!chunks.length) continue;
      const probes = [
        chunks[0],
        chunks[Math.floor(chunks.length / 2)],
        chunks[chunks.length - 1],
      ];
      await waitForIndex(repoIds.get(id), probes, cached);
    }

    for (const q of questions) {
      const hits = await retrieveByVector({
        repoId: repoIds.get(q.repoId),
        queryVector: cached.get(qInput(q)),
        limit: TOP_K,
        merge: cfg.merge,
      });
      results.push(makeResultRow(q, hits));
    }
  } finally {
    if (mongoose.connection.readyState === 1) {
      try {
        const r = await Chunk.deleteMany({ userId: EVAL_USER_ID });
        console.log(`Cleaned up ${r.deletedCount} throwaway chunks`);
      } catch (e) {
        console.error(
          "Cleanup failed (the TTL removes them within a day):",
          e?.message ?? e,
        );
      }
      await mongoose.disconnect();
    }
  }

  const rowProblems = checkResultRows(results);
  if (rowProblems.length)
    throw new Error(`Bad result rows: ${rowProblems.join("; ")}`);

  // 4. Report.
  const m = computeMetrics(results);
  const rows = [["group", "n", "hit@1", "hit@3", "hit@5", "MRR", "avg rank"]];
  const add = (name, g) =>
    rows.push([
      name,
      g.n,
      pct(g.hit1),
      pct(g.hit3),
      pct(g.hit5),
      fix(g.mrr),
      fix(g.avgRank, 2),
    ]);
  add("overall (on-topic)", m.overall);
  for (const k of ON_TOPIC_KINDS) add(k, m.byKind[k]);
  console.log(
    "\nMetric: FILE-level hit, any expected path among the top 5 results. MRR counts the top 5 only.",
  );
  printTable(rows);
  const sc = (name, s) =>
    console.log(
      `${name} top scores: ${s ? `n ${s.n}, min ${fix(s.min)}, p25 ${fix(s.p25)}, median ${fix(s.median)}, p75 ${fix(s.p75)}, max ${fix(s.max)}` : "none"}`,
    );
  sc("on-topic ", m.onTopicScores);
  sc("off-topic", m.offTopicScores);
  console.log(
    `Neurons used this run (estimate): ${neuronsUsed}; cache ${cacheHits} hits, ${cacheMisses} misses`,
  );

  const failed = results.filter(
    (r) => r.kind !== "off-topic" && r.rank === null,
  );
  const rec = {
    label: cfg.label,
    date: new Date().toISOString(),
    window: cfg.window,
    overlap: cfg.overlap,
    max_chars: cfg.maxChars,
    prefix: cfg.prefix ? "on" : "off",
    query_prefix: cfg.queryPrefix ? "on" : "off",
    merge: cfg.merge ? "on" : "off",
    questions: questions.length,
    chunks: stats.chunks,
    avg_chars: stats.avgChars,
    max_chunk_chars: stats.maxChars,
    over512_frac: stats.over512Frac,
    hit1: m.overall.hit1,
    hit3: m.overall.hit3,
    hit5: m.overall.hit5,
    mrr: m.overall.mrr,
    avg_rank: m.overall.avgRank,
    hit5_exact: m.byKind["exact-identifier"].hit5,
    hit5_conceptual: m.byKind.conceptual.hit5,
    hit5_multi: m.byKind["multi-file"].hit5,
    off_top_median: m.offTopicScores?.median,
    off_top_max: m.offTopicScores?.max,
    on_top_min: m.onTopicScores?.min,
    on_top_median: m.onTopicScores?.median,
    neurons_used: neuronsUsed,
    cache_hits: cacheHits,
    cache_misses: cacheMisses,
  };
  if (!fs.existsSync(RESULTS_CSV))
    fs.writeFileSync(RESULTS_CSV, csvHeader() + "\n");
  fs.appendFileSync(RESULTS_CSV, csvRow(rec) + "\n");

  const mdRow = (name, g) =>
    `| ${name} | ${g.n} | ${pct(g.hit1)} | ${pct(g.hit3)} | ${pct(g.hit5)} | ${fix(g.mrr)} | ${fix(g.avgRank, 2)} |`;
  const scoreLine = (name, s) =>
    `- ${name}: ${s ? `n ${s.n}, min ${fix(s.min)}, p25 ${fix(s.p25)}, median ${fix(s.median)}, p75 ${fix(s.p75)}, max ${fix(s.max)}` : "none"}`;
  const top3 = (r) =>
    r.top
      .slice(0, 3)
      .map((t) => `${t.path}:${t.lines} (${fix(t.score)})`)
      .join("; ") || "(no results)";
  const md = [
    `# Eval run: ${cfg.label}`,
    "",
    `Date: ${rec.date}`,
    "",
    "## Settings",
    `- window ${cfg.window}, overlap ${cfg.overlap}, max-chars ${cfg.maxChars}`,
    `- path prefix ${rec.prefix}, query prefix ${rec.query_prefix}, merge ${rec.merge}, exclude-tests ${cfg.excludeTests ? "on" : "off"}`,
    `- model ${config.EMBEDDING_MODEL}, ${config.EMBEDDING_DIMENSIONS} dims, top ${TOP_K}`,
    ...[...snaps].map(
      ([id, s]) =>
        `- repo ${id}: ${s.owner}/${s.repo} @ ${s.sha} (pin with "sha" in questions.json to freeze it)`,
    ),
    "",
    "## Chunks",
    `- ${stats.chunks} chunks, avg ${stats.avgChars} chars, max ${stats.maxChars}`,
    `- estimated over 512 tokens (chars/4, an estimate): ${stats.over512Count} (${pct(stats.over512Frac)})`,
    `- neurons used (estimate): ${neuronsUsed}; cache ${cacheHits} hits, ${cacheMisses} misses`,
    "",
    "## Metrics (file-level hit)",
    "A hit means any expected FILE appears in the top 5. Line ranges are not scored: chunk boundaries change with window, overlap and max-chars, so line labels would not be comparable across runs (D-078). MRR counts the top 5 only.",
    "",
    "| group | n | hit@1 | hit@3 | hit@5 | MRR | avg rank of first hit |",
    "|---|---|---|---|---|---|---|",
    mdRow("overall (on-topic)", m.overall),
    ...ON_TOPIC_KINDS.map((k) => mdRow(k, m.byKind[k])),
    "",
    "## Top-score distributions (for the 10B threshold)",
    scoreLine("on-topic", m.onTopicScores),
    scoreLine("off-topic", m.offTopicScores),
    "",
    `## Failed questions (${failed.length})`,
    ...(failed.length
      ? failed.flatMap((r) => [
          `- **${r.id}** [${r.kind}] ${r.question}`,
          `  - expected: ${r.expectedPaths.join(", ")}`,
          `  - got: ${top3(r)}`,
        ])
      : ["None."]),
    "",
    "## Off-topic questions",
    ...results
      .filter((r) => r.kind === "off-topic")
      .map(
        (r) =>
          `- **${r.id}** top score ${fix(r.topScore)}: ${r.question}  (got: ${top3(r)})`,
      ),
    "",
  ].join("\n");
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RUNS_DIR, `${cfg.label}.md`), md);
  const json = {
    label: cfg.label,
    date: rec.date,
    settings: {
      window: cfg.window,
      overlap: cfg.overlap,
      maxChars: cfg.maxChars,
      prefix: cfg.prefix,
      queryPrefix: cfg.queryPrefix,
      merge: cfg.merge,
      excludeTests: cfg.excludeTests,
    },
    results: results.map((r) => ({
      id: r.id,
      kind: r.kind,
      topScore: r.topScore,
      top: r.top, // top 5: { path, lines, score }
      rank: r.rank, // rank of the first expected file, null if none
    })),
  };
  fs.writeFileSync(
    path.join(RUNS_DIR, `${cfg.label}.json`),
    JSON.stringify(json, null, 2),
  );
  console.log(
    `\nWrote server/eval/runs/${cfg.label}.md and .json, and appended server/eval/results.csv`,
  );
}

try {
  await main();
} catch (err) {
  if (err instanceof GithubError || err instanceof EmbeddingError) {
    console.error(`${err.code}: ${err.message}`);
    process.exitCode = 2;
  } else {
    console.error("Error:", err?.message ?? err);
    process.exitCode = 1;
  }
}
