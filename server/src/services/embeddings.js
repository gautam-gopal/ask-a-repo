// The ONLY file that knows about Cloudflare Workers AI. Provider-neutral interface:
//   embedDocuments(texts, options?) -> number[][]  (same order as input)
//   embedQuery(text, options?)      -> number[]
//   getUsage() / resetUsage()       -> local ESTIMATES (the API reports no usage)
//   EmbeddingError { code, message, details }
import { config } from "../config.js";

// Named limits. 32 per request: below the per-request item cap I believe applies (100, verify),
// small enough that a failed batch wastes little quota and a request stays well inside the timeout.
export const BATCH_SIZE = 32;
export const CONCURRENCY = 2;
export const REQUEST_TIMEOUT_MS = 20_000;
export const MAX_RETRIES = 3;
export const BACKOFF_MS = 500;
export const MAX_RETRY_AFTER_MS = 30_000; // longer waits fail fast instead of blocking the ingest
export const DAILY_FREE_NEURONS = 10_000;
// 512-TOKEN LIMIT, NOT ENFORCED. The model reads at most 512 tokens and cuts the rest off
// silently. The chunker's 1500-char cap and this 1536-char threshold are ESTIMATES, not
// guarantees: code often tokenizes denser than 3 chars/token, so some chunks under the cap
// may still exceed 512 tokens and lose their tail. We neither reject nor split such inputs;
// getUsage().truncationRisk only counts inputs above the threshold. Phase 10 measures impact.
export const TRUNCATION_RISK_CHARS = 1536;

const NEURONS_PER_MILLION_TOKENS = 6058; // bge-base, from Cloudflare pricing (verify)
const CHARS_PER_TOKEN = 4; // rough estimate; code usually tokenizes denser, so this undercounts
const QUERY_PREFIX =
  "Represent this sentence for searching relevant passages: ";

// Codes: AUTH_FAILED, RATE_LIMITED, QUOTA_EXHAUSTED, BAD_RESPONSE,
// DIMENSION_MISMATCH, UPSTREAM_ERROR, TIMEOUT
export class EmbeddingError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "EmbeddingError";
    this.code = code;
    this.details = details;
  }
}

// ---- Local usage estimate (per process, resets on restart) ----
// requests = HTTP attempts sent (retries included); batches = batches that succeeded.
// Tokens, inputs and truncationRisk count successful batches only (failed attempts are
// assumed unbilled; unverified). All token and neuron figures are ESTIMATES.
const emptyUsage = () => ({
  requests: 0,
  batches: 0,
  inputs: 0,
  estTokens: 0,
  truncationRisk: 0,
});
let usage = emptyUsage();

export function resetUsage() {
  usage = emptyUsage();
}

export function getUsage() {
  return {
    ...usage,
    estNeurons:
      Math.round((usage.estTokens / 1e6) * NEURONS_PER_MILLION_TOKENS * 10) /
      10,
    dailyFreeNeurons: DAILY_FREE_NEURONS,
    isEstimate: true,
  };
}

// Pure estimate for one batch of texts (same chars/4 and neuron rate as getUsage).
export function estimateUsage(texts) {
  let estTokens = 0;
  for (const t of texts) estTokens += Math.ceil(t.length / CHARS_PER_TOKEN);
  return {
    estTokens,
    estNeurons: (estTokens / 1e6) * NEURONS_PER_MILLION_TOKENS,
  };
}

function record(texts) {
  usage.batches++;
  usage.inputs += texts.length;
  for (const t of texts) {
    usage.estTokens += Math.ceil(t.length / CHARS_PER_TOKEN);
    if (t.length > TRUNCATION_RISK_CHARS) usage.truncationRisk++;
  }
}

// ---- Response handling ----
function parseRetryAfter(value) {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}

function cfErrors(json) {
  return Array.isArray(json?.errors) ? json.errors : [];
}

// Cloudflare documents daily free-allocation exhaustion as error code 3036 (HTTP 429).
function isQuota(json) {
  return cfErrors(json).some((e) => e?.code === 3036);
}

// Only numeric Cloudflare codes and the status go into details; never bodies, messages or secrets.
function classify(status, headers, json) {
  const cfCodes = cfErrors(json)
    .map((e) => e?.code)
    .filter(Number.isInteger);
  if (isQuota(json)) {
    return new EmbeddingError(
      "QUOTA_EXHAUSTED",
      "Cloudflare daily free embedding allowance is used up. Try again after it resets (believed 00:00 UTC).",
      { status, cfCodes },
    );
  }
  if (status === 401 || status === 403) {
    return new EmbeddingError(
      "AUTH_FAILED",
      "Cloudflare rejected the credentials. Check the token's Workers AI permission and the account id.",
      { status, cfCodes },
    );
  }
  // Cloudflare documents HTTP 408 with codes 3007 and 3008 as timeouts. Retryable.
  if (status === 408 || cfCodes.includes(3007) || cfCodes.includes(3008)) {
    return new EmbeddingError(
      "TIMEOUT",
      "Cloudflare reported a request timeout",
      { status, cfCodes, retryable: true },
    );
  }
  if (status === 429) {
    return new EmbeddingError("RATE_LIMITED", "Cloudflare rate limit reached", {
      status,
      cfCodes,
      retryable: true,
      retryAfterMs: parseRetryAfter(headers?.get?.("retry-after")),
    });
  }
  return new EmbeddingError(
    "UPSTREAM_ERROR",
    `Cloudflare returned status ${status}`,
    { status, cfCodes, retryable: status >= 500 },
  );
}

function parseVectors(json, expected) {
  const data = json?.result?.data;
  if (!Array.isArray(data)) {
    throw new EmbeddingError(
      "BAD_RESPONSE",
      "Embedding response had no result.data array",
    );
  }
  if (data.length !== expected) {
    throw new EmbeddingError(
      "BAD_RESPONSE",
      `Embedding response had ${data.length} vectors for ${expected} inputs`,
    );
  }
  const dims = config.EMBEDDING_DIMENSIONS;
  for (const v of data) {
    if (!Array.isArray(v)) {
      throw new EmbeddingError("BAD_RESPONSE", "A vector was not an array");
    }
    if (v.length !== dims) {
      throw new EmbeddingError(
        "DIMENSION_MISMATCH",
        `Expected ${dims}-dimension vectors, got ${v.length}`,
        { expected: dims, got: v.length },
      );
    }
    if (!v.every((x) => Number.isFinite(x))) {
      throw new EmbeddingError(
        "BAD_RESPONSE",
        "A vector had non-numeric values",
      );
    }
  }
  return data;
}

// ---- One HTTP attempt ----
async function request(texts, timeoutMs) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${config.CLOUDFLARE_ACCOUNT_ID}/ai/run/${config.EMBEDDING_MODEL}`;
  usage.requests++; // counts every HTTP attempt, including retries
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let status;
  let headers;
  let bodyText;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.CLOUDFLARE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      // cls pooling: the BGE-recommended pooling (verify it is accepted).
      body: JSON.stringify({ text: texts, pooling: "cls" }),
      signal: controller.signal,
    });
    status = res.status;
    headers = res.headers;
    bodyText = await res.text(); // inside try so the timeout covers the body too
  } catch (err) {
    // Discard err entirely: it could carry request details. Keep the token out of messages.
    if (err?.name === "AbortError") {
      throw new EmbeddingError(
        "TIMEOUT",
        `Embedding request timed out after ${timeoutMs} ms`,
        { retryable: true },
      );
    }
    throw new EmbeddingError(
      "UPSTREAM_ERROR",
      "Could not reach the embedding service",
      { retryable: true },
    );
  } finally {
    clearTimeout(timer);
  }

  let json = null;
  try {
    json = JSON.parse(bodyText);
  } catch {
    // non-JSON body: handled below
  }
  if (status < 200 || status >= 300 || json?.success === false) {
    throw classify(status, headers, json);
  }
  return parseVectors(json, texts.length);
}

// Retries network errors, timeouts, 429 and 5xx. Never retries auth, quota or bad responses.
async function withRetry(texts, o) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await request(texts, o.timeoutMs);
    } catch (err) {
      const retryable = err instanceof EmbeddingError && err.details.retryable;
      if (!retryable || attempt >= o.maxRetries) throw err;
      const retryAfter = err.details.retryAfterMs;
      if (retryAfter != null && retryAfter > MAX_RETRY_AFTER_MS) throw err;
      await o.sleep(
        retryAfter ?? o.backoffMs * 2 ** attempt * (0.5 + Math.random()),
      );
    }
  }
}

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function resolveOptions(options) {
  return {
    batchSize: BATCH_SIZE,
    concurrency: CONCURRENCY,
    timeoutMs: REQUEST_TIMEOUT_MS,
    maxRetries: MAX_RETRIES,
    backoffMs: BACKOFF_MS,
    sleep: realSleep,
    ...options,
  };
}

function checkTexts(texts) {
  if (!Array.isArray(texts)) throw new TypeError("texts must be an array");
  for (const t of texts) {
    if (typeof t !== "string" || t.trim() === "")
      throw new TypeError("every text must be a non-blank string");
  }
}

// ---- Public interface ----
export async function embedDocuments(texts, options = {}) {
  checkTexts(texts);
  if (texts.length === 0) return [];
  const o = resolveOptions(options);

  const batches = [];
  for (let i = 0; i < texts.length; i += o.batchSize) {
    batches.push(texts.slice(i, i + o.batchSize));
  }
  const results = new Array(batches.length);
  let next = 0;
  let stop = false; // a failure stops other workers from starting new batches

  async function worker() {
    while (!stop) {
      const i = next++;
      if (i >= batches.length) return;
      try {
        results[i] = await withRetry(batches[i], o);
        record(batches[i]);
      } catch (err) {
        stop = true;
        throw err;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(o.concurrency, batches.length) }, worker),
  );
  return results.flat();
}

export async function embedQuery(text, options = {}) {
  checkTexts([text]);
  const o = resolveOptions(options);
  const usePrefix = options.queryPrefix ?? config.QUERY_PREFIX_ENABLED;
  const input = usePrefix ? QUERY_PREFIX + text : text;
  const vec = await withRetry([input], o);
  record([input]);
  return vec[0];
}
