import mongoose from "mongoose";
import { config } from "../src/config.js";
import { retrieve } from "../src/services/retrieve.js";
import { answerQuestion } from "../src/services/answer.js";
import { EmbeddingError } from "../src/services/embeddings.js";
import { LlmError } from "../src/services/llm.js";

const args = process.argv.slice(2);
const yes = args.includes("--yes");
const [repoId, question] = args.filter((a) => !a.startsWith("--"));
const USAGE =
  'Usage: node server/scripts/ask-test.js <repoId> "<question>" --yes';

if (!repoId || !/^[0-9a-f]{24}$/i.test(repoId) || !question) {
  console.error(USAGE);
  process.exit(1);
}
if (!yes) {
  console.log(
    "This spends 1 Cloudflare embedding call and up to 1 Groq request (more on fallback).",
  );
  console.log("Not started. Re-run with --yes.");
  process.exit(0);
}

try {
  await mongoose.connect(config.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
  });
  const t0 = Date.now();
  const hits = await retrieve({ repoId, query: question, limit: 5 });
  console.log(`Question: ${question}`);
  console.log(`SEARCH_MIN_SCORE: ${config.SEARCH_MIN_SCORE}`);
  console.log("Retrieved:");
  hits.forEach((h, i) =>
    console.log(
      `  #${i + 1}  ${h.score.toFixed(4)}  ${h.path}:${h.startLine}-${h.endLine}`,
    ),
  );
  const r = await answerQuestion({ question, hits });
  const ms = Date.now() - t0;
  if (r.notFound) {
    console.log("\nNOT FOUND path: LLM not called.");
  } else {
    console.log(`\nPrompt size: ~${r.promptTokensEstimate} tokens (estimate)`);
    console.log(`\nAnswer:\n${r.answer}`);
    console.log("\nSources:");
    r.sources.forEach((s) =>
      console.log(
        `  [${s.n}] ${s.path}:${s.startLine}-${s.endLine}  score ${s.score.toFixed(4)}  cited: ${s.cited}`,
      ),
    );
    console.log(`\nModel: ${r.model}  fallback used: ${r.usedFallback}`);
    console.log(`Usage: ${r.usage ? JSON.stringify(r.usage) : "not reported"}`);
  }
  console.log(`Latency (retrieve + answer): ${ms} ms`);
} catch (err) {
  if (err instanceof EmbeddingError || err instanceof LlmError) {
    console.error(
      `${err.code}: ${err.message}${err.retryAfterSeconds ? ` (retry after ${err.retryAfterSeconds}s)` : ""}`,
    );
    process.exitCode = 2;
  } else {
    console.error("Error:", err?.message ?? err);
    process.exitCode = 1;
  }
} finally {
  await mongoose.disconnect();
}
