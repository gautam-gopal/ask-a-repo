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
import { Repo } from "../src/models/Repo.js";
import { Chunk } from "../src/models/Chunk.js";

const args = process.argv.slice(2);
const yes = args.includes("--yes");
const keep = args.includes("--keep");
const url = args.find((a) => a.startsWith("http"));
if (!url) {
  console.error(
    "Usage: node server/scripts/ingest-run.js <github-repo-url> [--yes] [--keep]",
  );
  process.exit(1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let repoId = null;
try {
  // Estimate first: GitHub calls only, no Cloudflare quota, no database.
  const loaded = await loadRepo(url);
  const { chunks } = chunkRepo(loaded.files);
  const est = estimateUsage(chunks.map((c) => c.embedText));
  console.log(
    `${loaded.owner}/${loaded.repo}: ${loaded.files.length} files, ${chunks.length} chunks`,
  );
  console.log(
    `Estimated cost: ~${Math.round(est.estNeurons * 10) / 10} neurons of ${DAILY_FREE_NEURONS}/day (estimate; chars/4 undercounts code)`,
  );
  if (!yes) {
    console.log("Not started. Re-run with --yes to index for real.");
  } else {
    await mongoose.connect(config.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
    });
    await Repo.init();
    await Chunk.init();
    const userId = new mongoose.Types.ObjectId(); // throwaway user
    const t0 = Date.now();
    const created = await startIngest({ userId, url });
    repoId = created._id;
    console.log(`Started repo ${repoId} (throwaway user ${userId})`);

    let doc;
    for (;;) {
      await sleep(2000);
      doc = await Repo.findById(repoId).lean();
      if (!doc) {
        console.log("Repo document vanished");
        break;
      }
      console.log(
        `  ${doc.status}  ${doc.progress.embedded}/${doc.progress.total}`,
      );
      if (doc.status === "ready" || doc.status === "failed") break;
    }
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const inDb = await Chunk.countDocuments({ repoId });
    console.log("\nFinal repo document:");
    console.log(JSON.stringify(doc, null, 2));
    console.log(`Chunks in database: ${inDb}`);
    console.log(`Total time: ${secs}s`);
    console.log(
      `Estimated neurons used: ${doc?.usage?.estimatedNeurons ?? "n/a"}`,
    );
    if (keep)
      console.log(
        `Kept (expires in 7 days). Atlas filter: { repoId: ObjectId("${repoId}") }`,
      );
  }
} catch (err) {
  if (
    err instanceof GithubError ||
    err instanceof EmbeddingError ||
    err instanceof IngestError
  ) {
    console.error(`${err.code}: ${err.message}`);
    process.exitCode = 2;
  } else {
    console.error("Error:", err?.message ?? err);
    process.exitCode = 1;
  }
} finally {
  if (mongoose.connection.readyState === 1) {
    if (repoId && !keep) {
      const r = await Chunk.deleteMany({ repoId });
      await Repo.deleteOne({ _id: repoId });
      console.log(`Cleaned up repo and ${r.deletedCount} chunks`);
    }
    await mongoose.disconnect();
  }
}
