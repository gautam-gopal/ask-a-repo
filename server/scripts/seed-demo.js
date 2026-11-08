import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { config } from "../src/config.js";
import { loadRepo, GithubError } from "../src/services/github.js";
import { chunkRepo } from "../src/services/chunker.js";
import {
  estimateUsage,
  EmbeddingError,
  DAILY_FREE_NEURONS,
} from "../src/services/embeddings.js";
import { startIngest, IngestError } from "../src/services/ingest.js";
import { assertNeurons } from "../src/services/usage.js";
import { planRepos } from "../src/services/demoSeed.js";
import { DEMO_EMAIL } from "../src/middleware/demo.js";
import { AppError } from "../src/middleware/errors.js";
import { User } from "../src/models/User.js";
import { Repo } from "../src/models/Repo.js";
import { Chunk } from "../src/models/Chunk.js";
import { Usage } from "../src/models/Usage.js";

const args = process.argv.slice(2);
const yes = args.includes("--yes");
const urls = args.filter((a) => a.startsWith("http"));
const USAGE =
  "Usage: node server/scripts/seed-demo.js <nextalk-url> <other-url> [--yes]";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r1 = (n) => Math.round(n * 10) / 10;

if (urls.length !== 2) {
  console.error(USAGE);
  process.exit(1);
}
if (!config.DEMO_PASSWORD) {
  console.error("Set DEMO_PASSWORD in .env first (12+ characters).");
  process.exit(1);
}

async function upsertDemoUser() {
  const passwordHash = await bcrypt.hash(config.DEMO_PASSWORD, 10);
  const found = await User.findOne({ email: DEMO_EMAIL });
  // Direct create: this never goes through the signup route, so the signup cap does not apply.
  if (!found)
    return User.create({ email: DEMO_EMAIL, passwordHash, isDemo: true });
  if (!found.isDemo)
    throw new Error(
      "An account with the demo email exists but is not a demo account. Delete it in Atlas first.",
    );
  await User.updateOne({ _id: found._id }, { $set: { passwordHash } });
  return found;
}

async function waitReady(repoId) {
  for (;;) {
    await sleep(2000);
    const doc = await Repo.findById(repoId).lean();
    if (!doc) throw new Error("The repo document vanished while indexing");
    console.log(
      `  ${doc.owner}/${doc.name}: ${doc.status} ${doc.progress.embedded}/${doc.progress.total}`,
    );
    if (doc.status === "ready") return;
    if (doc.status === "failed")
      throw new Error(`Indexing failed: ${doc.error?.code}`);
  }
}

try {
  planRepos(urls, []); // validates both URLs before any network call

  // 1. Estimate (GitHub requests only, no database, no quota).
  const estimates = new Map();
  for (const url of urls) {
    const loaded = await loadRepo(url, {
      excludeTests: config.INDEX_EXCLUDE_TESTS,
    });
    const { chunks } = chunkRepo(loaded.files);
    const est = estimateUsage(chunks.map((c) => c.embedText));
    estimates.set(url, est.estNeurons);
    console.log(
      `${loaded.owner}/${loaded.repo}: ${loaded.files.length} files, ${chunks.length} chunks, ~${r1(est.estNeurons)} neurons`,
    );
  }
  const all = [...estimates.values()].reduce((a, b) => a + b, 0);
  console.log(
    `Estimated total if both are indexed: ~${r1(all)} neurons of ${DAILY_FREE_NEURONS}/day (estimate; repos that are already ready cost nothing).`,
  );
  if (!yes) {
    console.log("Not started. Re-run with --yes.");
  } else {
    // 2. Write.
    await mongoose.connect(config.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
    });
    await User.init();
    await Repo.init();
    await Chunk.init();
    await Usage.init();
    const user = await upsertDemoUser();
    const existing = await Repo.find({ userId: user._id }).lean();
    const plan = planRepos(urls, existing);
    for (const p of plan) console.log(`${p.key}: ${p.action}`);

    const todo = plan.filter((p) => p.action !== "skip");
    const cost = todo.reduce((s, p) => s + estimates.get(p.url), 0);
    await assertNeurons(cost); // refuses (DAILY_BUDGET) if today's budget cannot cover it

    for (const p of todo) {
      const old = existing.find(
        (r) => `${r.ownerLower}/${r.nameLower}` === p.key,
      );
      if (p.action === "replace" && old) {
        await Chunk.deleteMany({ repoId: old._id });
        await Repo.deleteOne({ _id: old._id });
      }
      // isDemo: true skips the per-user repo cap (ingest.js) and creates a repo with no expiry.
      const repo = await startIngest({
        userId: user._id,
        url: p.url,
        isDemo: true,
      });
      await waitReady(repo._id);
    }
    console.log("Demo data is ready.");
  }
} catch (err) {
  if (
    err instanceof GithubError ||
    err instanceof EmbeddingError ||
    err instanceof IngestError ||
    err instanceof AppError
  ) {
    console.error(`${err.code}: ${err.message}`);
    process.exitCode = 2;
  } else {
    console.error("Error:", err?.message ?? err);
    process.exitCode = 1;
  }
} finally {
  if (mongoose.connection.readyState === 1) await mongoose.disconnect();
}
