import { config } from "../src/config.js";
import {
  embedDocuments,
  embedQuery,
  getUsage,
  EmbeddingError,
} from "../src/services/embeddings.js";

const docs = [
  "File: src/auth.js\nfunction login(email, password) { /* checks the password hash */ }",
  "File: src/db.js\nexport async function connect(uri) { return mongoose.connect(uri); }",
  "File: README.md\n# Pasta recipes\nBoil water, add salt, cook for ten minutes.",
];
const query = "where is the login handled";

const cosine = (a, b) => {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / Math.sqrt(na * nb);
};

try {
  console.log(
    `Model: ${config.EMBEDDING_MODEL}  dims: ${config.EMBEDDING_DIMENSIONS}  query prefix: ${config.QUERY_PREFIX_ENABLED}`,
  );
  const t0 = Date.now();
  const vectors = await embedDocuments(docs);
  const t1 = Date.now();
  const q = await embedQuery(query);
  const t2 = Date.now();

  console.log(
    `Documents: ${vectors.length} vectors, length ${vectors[0].length}, ${t1 - t0} ms`,
  );
  console.log(`Query:     length ${q.length}, ${t2 - t1} ms`);
  docs.forEach((d, i) =>
    console.log(
      `  cosine(query, doc ${i}) = ${cosine(q, vectors[i]).toFixed(4)}  ${d.split("\n")[0]}`,
    ),
  );
  const u = getUsage();
  console.log(
    `Estimated usage: ${u.estTokens} tokens, ~${u.estNeurons} neurons of ${u.dailyFreeNeurons}/day (estimate), ${u.requests} HTTP requests, ${u.batches} batches, ${u.truncationRisk} inputs over the truncation-risk threshold`,
  );
} catch (err) {
  if (err instanceof EmbeddingError) {
    console.error(`${err.code}: ${err.message}`);
    process.exit(2);
  }
  console.error("Unexpected error:", err?.message ?? err);
  process.exit(1);
}
