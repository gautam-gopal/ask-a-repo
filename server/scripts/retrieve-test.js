import fs from "node:fs";
import mongoose from "mongoose";
import { config } from "../src/config.js";
import { retrieve } from "../src/services/retrieve.js";
import { EmbeddingError } from "../src/services/embeddings.js";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const expectArg = flag("--expect");
const fileArg = flag("--file");
const [repoId, question] = args.filter(
  (a, i) =>
    !a.startsWith("--") && !["--expect", "--file"].includes(args[i - 1]),
);
const USAGE = `Usage:
  node server/scripts/retrieve-test.js <repoId> "<question>" [--expect path1,path2]
  node server/scripts/retrieve-test.js <repoId> --file questions.json   (array of { question, expectedPaths })`;

if (!repoId || !/^[0-9a-f]{24}$/i.test(repoId) || (!question && !fileArg)) {
  console.error(USAGE);
  process.exit(1);
}

const rankOf = (hits, expected) => {
  const i = hits.findIndex((h) => expected.includes(h.path));
  return i === -1 ? null : i + 1;
};

try {
  await mongoose.connect(config.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
  });

  if (fileArg) {
    const items = JSON.parse(fs.readFileSync(fileArg, "utf8"));
    if (!Array.isArray(items)) throw new Error("file must be a JSON array");
    let hitCount = 0;
    for (const it of items) {
      const hits = await retrieve({ repoId, query: it.question, limit: 5 });
      const rank = rankOf(hits, it.expectedPaths ?? []);
      if (rank) hitCount++;
      console.log(
        `${rank ? `HIT  rank ${rank}` : "MISS      "}  ${it.question}`,
      );
    }
    console.log(`\nhit@5: ${hitCount}/${items.length}`);
  } else {
    const t0 = Date.now();
    const hits = await retrieve({ repoId, query: question, limit: 5 });
    const ms = Date.now() - t0;
    console.log(`Question: ${question}`);
    hits.forEach((h, i) => {
      const preview = h.text.replace(/\s+/g, " ").slice(0, 100);
      console.log(
        `#${i + 1}  ${h.score.toFixed(4)}  ${h.path}:${h.startLine}-${h.endLine}  mergedFrom ${h.mergedFrom}\n      ${preview}`,
      );
    });
    console.log(`Time: ${ms} ms`);
    if (expectArg) {
      const expected = expectArg.split(",").map((s) => s.trim());
      const rank = rankOf(hits, expected);
      console.log(
        rank ? `EXPECTED FOUND at rank ${rank}` : "EXPECTED NOT FOUND in top 5",
      );
    }
  }
} catch (err) {
  if (err instanceof EmbeddingError) {
    console.error(`${err.code}: ${err.message}`);
    process.exitCode = 2;
  } else {
    console.error("Error:", err?.message ?? err);
    process.exitCode = 1;
  }
} finally {
  await mongoose.disconnect();
}
