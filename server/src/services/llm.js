// The ONLY file that knows about Groq. Provider-neutral interface:
//   chat({ messages, model, maxTokens, temperature }, options?) -> { text, model, usage }
//   generate({ messages }, options?) -> { text, model, usedFallback, usage }
//   LlmError { code, message, details, retryAfterSeconds }
import { config } from "../config.js";

export const MAX_TOKENS = 700; // answer length cap
export const TEMPERATURE = 0.1;
export const REQUEST_TIMEOUT_MS = 30_000;
export const MAX_RETRIES = 2; // network errors and 5xx only
export const BACKOFF_MS = 500;
const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
// Unverified provider error code strings (check Groq docs).
const MODEL_ERROR_CODES = new Set([
  "model_not_found",
  "model_decommissioned",
  "model_not_active",
]);
const FALLBACK_ON = new Set(["RATE_LIMITED", "MODEL_UNAVAILABLE"]);

// Codes: AUTH_FAILED, RATE_LIMITED, MODEL_UNAVAILABLE, BAD_RESPONSE, UPSTREAM_ERROR, TIMEOUT
export class LlmError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "LlmError";
    this.code = code;
    this.details = details;
    this.retryAfterSeconds = details.retryAfterSeconds ?? null;
  }
}

// Only a short lowercase code string is ever copied from the provider body.
function providerCode(json) {
  const c = json?.error?.code;
  return typeof c === "string" && /^[a-z0-9_]{1,60}$/.test(c) ? c : null;
}

function parseRetryAfter(value) {
  const secs = Number(value);
  return value != null && Number.isFinite(secs) && secs >= 0
    ? Math.ceil(secs)
    : null;
}

// Messages are fixed strings. Bodies, headers and the key never go into errors.
function classify(status, headers, json) {
  const code = providerCode(json);
  const base = { status, providerCode: code };
  if (status === 401 || status === 403)
    return new LlmError(
      "AUTH_FAILED",
      "The language model rejected the server credentials.",
      base,
    );
  if (status === 429)
    return new LlmError("RATE_LIMITED", "Language model rate limit reached.", {
      ...base,
      retryAfterSeconds: parseRetryAfter(headers?.get?.("retry-after")),
    });
  if (status === 404 || (code && MODEL_ERROR_CODES.has(code)))
    return new LlmError(
      "MODEL_UNAVAILABLE",
      "The language model is not available.",
      base,
    );
  return new LlmError(
    "UPSTREAM_ERROR",
    `Language model returned status ${status}`,
    { ...base, retryable: status >= 500 },
  );
}

function parseResponse(json, model) {
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim() === "")
    throw new LlmError(
      "BAD_RESPONSE",
      "The language model returned an unexpected response.",
    );
  const u = json.usage;
  const usage =
    u && Number.isFinite(u.total_tokens)
      ? {
          promptTokens: u.prompt_tokens ?? null,
          completionTokens: u.completion_tokens ?? null,
          totalTokens: u.total_tokens,
        }
      : null;
  return { text: content.trim(), model, usage };
}

// One HTTP attempt.
async function request(body, model, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let status;
  let headers;
  let bodyText;
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    status = res.status;
    headers = res.headers;
    bodyText = await res.text(); // inside try so the timeout covers the body
  } catch (err) {
    // Discard err entirely: it could carry request details.
    if (err?.name === "AbortError")
      throw new LlmError(
        "TIMEOUT",
        `Language model request timed out after ${timeoutMs} ms`,
      ); // not retried: a retry would double a 30 s wait
    throw new LlmError(
      "UPSTREAM_ERROR",
      "Could not reach the language model service.",
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
  if (status < 200 || status >= 300) throw classify(status, headers, json);
  return parseResponse(json, model);
}

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function chat(
  { messages, model, maxTokens = MAX_TOKENS, temperature = TEMPERATURE },
  options = {},
) {
  if (!Array.isArray(messages) || messages.length === 0)
    throw new TypeError("messages must be a non-empty array");
  if (typeof model !== "string" || model === "")
    throw new TypeError("model must be a non-empty string");
  const o = {
    timeoutMs: REQUEST_TIMEOUT_MS,
    maxRetries: MAX_RETRIES,
    backoffMs: BACKOFF_MS,
    sleep: realSleep,
    ...options,
  };
  const body = {
    model,
    messages,
    max_completion_tokens: maxTokens, // Groq deprecated max_tokens in favour of this
    temperature,
  };
  for (let attempt = 0; ; attempt++) {
    try {
      return await request(body, model, o.timeoutMs);
    } catch (err) {
      const retryable = err instanceof LlmError && err.details.retryable;
      if (!retryable || attempt >= o.maxRetries) throw err;
      await o.sleep(o.backoffMs * 2 ** attempt * (0.5 + Math.random()));
    }
  }
}

// Primary model; on RATE_LIMITED or MODEL_UNAVAILABLE one try on the fallback.
// Never falls back on AUTH_FAILED (same key) or other errors. If the fallback also
// fails, its error is thrown (it carries the freshest retryAfterSeconds).
export async function generate({ messages }, options = {}) {
  const primary = config.GROQ_MODEL;
  const fallback = config.GROQ_FALLBACK_MODEL;
  try {
    const r = await chat({ messages, model: primary }, options);
    return { ...r, usedFallback: false };
  } catch (err) {
    if (
      !(err instanceof LlmError) ||
      !FALLBACK_ON.has(err.code) ||
      fallback === primary
    )
      throw err;
    const r = await chat({ messages, model: fallback }, options);
    return { ...r, usedFallback: true };
  }
}
