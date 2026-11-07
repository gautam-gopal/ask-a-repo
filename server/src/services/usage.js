// Global daily budget guard (D-094). ESTIMATES ONLY. What they do NOT capture:
// - neurons: chars/4 undercounts code; Cloudflare's real billing, and whether failed or retried
//   calls are billed, are unverified; its reset time is believed 00:00 UTC, unverified.
// - Groq: only a request count. Real limits are per model, per minute AND per day, in requests
//   AND tokens, so this is a coarse brake. Failed calls, 5xx retries and aborted streams are not counted.
// - check-then-record is not atomic: concurrent requests can overshoot slightly.
import { Usage } from "../models/Usage.js";
import { AppError } from "../middleware/errors.js";
import { config } from "../config.js";
import { estimateUsage } from "./embeddings.js";

export const budgets = {
  neurons: config.DAILY_NEURON_BUDGET,
  llm: config.DAILY_LLM_REQUEST_BUDGET,
}; // mutable for tests
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);

function hoursToReset() {
  const n = new Date();
  const next = Date.UTC(
    n.getUTCFullYear(),
    n.getUTCMonth(),
    n.getUTCDate() + 1,
  );
  return Math.max(1, Math.ceil((next - n.getTime()) / 3_600_000));
}
const refused = (what) =>
  new AppError(
    503,
    "DAILY_BUDGET",
    `The app's daily ${what} allowance is used up. It resets at midnight UTC (in about ${hoursToReset()} hours).`,
  );

export async function getToday() {
  const doc = await Usage.findOne({ day: utcDay() }).lean();
  return { neurons: doc?.neurons ?? 0, llmRequests: doc?.llmRequests ?? 0 };
}

export async function assertNeurons(needed = 0) {
  const { neurons } = await getToday();
  if (neurons >= budgets.neurons || neurons + needed > budgets.neurons)
    throw refused("embedding");
}
export async function assertLlm() {
  const { llmRequests } = await getToday();
  if (llmRequests >= budgets.llm) throw refused("answer");
}

async function add(inc) {
  const day = utcDay();
  const run = () =>
    Usage.updateOne(
      { day },
      { $inc: inc, $setOnInsert: { expiresAt: new Date(Date.now() + TTL_MS) } },
      { upsert: true },
    );
  try {
    await run();
  } catch (err) {
    if (err?.code === 11000)
      await run(); // two first-of-day upserts raced
    else throw err;
  }
}

// Recording never fails a request: losing a count is better than losing an answer.
export async function recordNeurons(n) {
  try {
    await add({ neurons: n });
  } catch (err) {
    console.warn("Usage record failed:", err?.name);
  }
}
export async function recordLlm(n = 1) {
  try {
    await add({ llmRequests: n });
  } catch (err) {
    console.warn("Usage record failed:", err?.name);
  }
}
export const recordQueryEmbedding = (question) =>
  recordNeurons(estimateUsage([question]).estNeurons);
