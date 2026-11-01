import mongoose from "mongoose";
import { config } from "../src/config.js";
import { loadRepo, GithubError } from "../src/services/github.js";
import { chunkRepo } from "../src/services/chunker.js";
import {
  embedDocuments,
  embedQuery,
  getUsage,
  EmbeddingError,
} from "../src/services/embeddings.js";
import { Chunk, VECTOR_INDEX_NAME } from "../src/models/Chunk.js";

// Fixed dummy ids so search and cleanup can find what load inserted.
const REPO_ID = new mongoose.Types.ObjectId("a".repeat(24));
const USER_ID = new mongoose.Types.ObjectId("b".repeat(24));
const LOAD_CHUNKS = 10; // embedding budget: load = 10, each search = 1
const DAY_MS = 24 * 60 * 60 * 1000;

const [mode, arg] = process.argv.slice(2);
const USAGE = `Usage:
  node server/scripts/vector-test.js load <github-repo-url>
  node server/scripts/vector-test.js search "<question>"
  node server/scripts/vector-test.js cleanup`;

async function load(url) {
  const repo = await loadRepo(url);
  const { chunks } = chunkRepo(repo.files);
  const first = chunks.slice(0, LOAD_CHUNKS);
  if (first.length === 0) throw new Error("No chunks produced");

  const vectors = await embedDocuments(first.map((c) => c.embedText));

  await Chunk.init(); // creates the collection and the regular/TTL indexes
  await Chunk.deleteMany({ repoId: REPO_ID }); // makes load safe to re-run
  const expiresAt = new Date(Date.now() + DAY_MS);
  await Chunk.insertMany(
    first.map((c, i) => ({
      repoId: REPO_ID,
      userId: USER_ID,
      path: c.path,
      startLine: c.startLine,
      endLine: c.endLine,
      text: c.text,
      embedding: vectors[i],
      expiresAt,
    })),
  );

  console.log(
    `Loaded ${first.length} chunks from ${repo.owner}/${repo.repo} @ ${repo.sha.slice(0, 7)}; expire ${expiresAt.toISOString()}`,
  );
  first.forEach((c, i) =>
    console.log(
      `  ${String(i + 1).padStart(2)}  ${c.path}:${c.startLine}-${c.endLine}`,
    ),
  );
}

async function search(question) {
  const queryVector = await embedQuery(question);

  // $vectorSearch must be the first stage. Aggregation does not cast values, so REPO_ID is
  // a real ObjectId. aggregate() ignores select:false, so embedding is projected out here.
  // numCandidates: how many nearest neighbours the approximate search examines before
  //   keeping the best `limit`. More is better recall but slower; it must be >= limit.
  // filter: only fields declared as type "filter" in the index definition can be used here.
  //   An undeclared field makes the query fail or match nothing, so repoId must be declared.
  const hits = await Chunk.aggregate([
    {
      $vectorSearch: {
        index: VECTOR_INDEX_NAME,
        path: "embedding",
        queryVector,
        numCandidates: 100,
        limit: 5,
        filter: { repoId: { $eq: REPO_ID } },
      },
    },
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
  ]);

  console.log(`Question: ${question}`);
  if (hits.length === 0) {
    console.log(
      "No results: the index may not be READY or still syncing, the name may differ from " +
        VECTOR_INDEX_NAME +
        ", or repoId is not declared as a filter field.",
    );
    return;
  }
  hits.forEach((h, i) => {
    const preview = h.text.replace(/\s+/g, " ").slice(0, 80);
    console.log(
      `#${i + 1}  score ${h.score.toFixed(4)}  ${h.path}:${h.startLine}-${h.endLine}\n      ${preview}`,
    );
  });
}

async function cleanup() {
  const res = await Chunk.deleteMany({ repoId: REPO_ID });
  console.log(`Deleted ${res.deletedCount} chunks`);
}

if (
  !["load", "search", "cleanup"].includes(mode) ||
  (mode !== "cleanup" && !arg)
) {
  console.error(USAGE);
  process.exit(1);
}

try {
  await mongoose.connect(config.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
  });
  if (mode === "load") await load(arg);
  else if (mode === "search") await search(arg);
  else await cleanup();
  const u = getUsage();
  if (u.inputs > 0)
    console.log(
      `Embeddings this run: ${u.inputs} inputs, ~${u.estNeurons} neurons (estimate)`,
    );
} catch (err) {
  if (err instanceof GithubError || err instanceof EmbeddingError) {
    console.error(`${err.code}: ${err.message}`);
    process.exitCode = 2;
  } else {
    console.error("Error:", err?.message ?? err);
    process.exitCode = 1;
  }
} finally {
  await mongoose.disconnect();
}
