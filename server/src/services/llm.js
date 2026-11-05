// The ONLY file that knows about Groq. Provider-neutral interface:
//   chat({ messages, model, maxTokens, temperature }, options?) -> { text, model, usage }
//   generate({ messages }, options?) -> { text, model, usedFallback, usage }
//   LlmError { code, message, details, retryAfterSeconds }
import { config } from "../config.js";

export const MAX_TOKENS = 1500; // answer cap; gpt-oss reasoning tokens count against it (D-073)
export const TEMPERATURE = 0.1;
export const REQUEST_TIMEOUT_MS = 30_000;
export const MAX_RETRIES = 2; // network errors and 5xx only
export const BACKOFF_MS = 500;
export const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
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

// ---- Streaming (Phase 9A) ----
export const STREAM_IDLE_MS = 30_000; // max silence between chunks once the stream has started

// gpt-oss only: hide reasoning and keep it short so it cannot eat max_completion_tokens.
// include_usage asks for a final usage chunk; usage stays optional in the code.
const isGptOss = (model) => model.startsWith("openai/gpt-oss");
export function buildStreamBody(model, messages) {
  return {
    model,
    messages,
    max_completion_tokens: MAX_TOKENS,
    temperature: TEMPERATURE,
    stream: true,
    stream_options: { include_usage: true },
    ...(isGptOss(model)
      ? { include_reasoning: false, reasoning_effort: "low" }
      : {}),
  };
}

// SSE line parser. feed() takes decoded text in any split; end() flushes. Handles \n, \r\n, \r,
// comment lines (":"), blank-line dispatch, multi-line data, and the [DONE] marker.
export function createSseParser({ onData, onDone }) {
  let buf = "";
  let dataLines = [];
  const dispatch = () => {
    if (dataLines.length === 0) return;
    const data = dataLines.join("\n");
    dataLines = [];
    if (data === "") return;
    if (data === "[DONE]") return onDone();
    onData(data);
  };
  const line = (l) => {
    if (l === "") return dispatch();
    if (l.startsWith(":")) return;
    const i = l.indexOf(":");
    const field = i === -1 ? l : l.slice(0, i);
    let value = i === -1 ? "" : l.slice(i + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") dataLines.push(value);
  };
  const drain = (final) => {
    for (;;) {
      const m = /\r\n|\n|\r/.exec(buf);
      if (!m) return;
      // A trailing "\r" may be the first half of "\r\n": wait for more text.
      if (m[0] === "\r" && m.index + 1 === buf.length && !final) return;
      line(buf.slice(0, m.index));
      buf = buf.slice(m.index + m[0].length);
    }
  };
  return {
    feed(text) {
      buf += text;
      drain(false);
    },
    end() {
      drain(true);
      if (buf !== "") line(buf);
      buf = "";
      dispatch();
    },
  };
}

const toUsage = (u) =>
  u && Number.isFinite(u.total_tokens)
    ? {
        promptTokens: u.prompt_tokens ?? null,
        completionTokens: u.completion_tokens ?? null,
        totalTokens: u.total_tokens,
      }
    : null;

// An error object sent as a data event in the middle of a stream. Fixed messages only.
function midStreamError(json) {
  const code = providerCode(json);
  if (code && MODEL_ERROR_CODES.has(code))
    return new LlmError(
      "MODEL_UNAVAILABLE",
      "The language model is not available.",
      { providerCode: code },
    );
  if (code && code.includes("rate_limit"))
    return new LlmError("RATE_LIMITED", "Language model rate limit reached.", {
      providerCode: code,
    });
  return new LlmError("UPSTREAM_ERROR", "The language model stream failed.", {
    providerCode: code,
  });
}

// One streaming attempt on one model. Forwards ONLY delta.content (never reasoning).
async function streamOnce({ messages, model, signal, onToken, o }) {
  const cancelled = () => new LlmError("ABORTED", "The request was cancelled.");
  if (signal?.aborted) throw cancelled();

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  let timer = null;
  let timedOut = false;
  const arm = (ms) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, ms);
  };

  let text = "";
  let usage = null;
  let finishReason = null;
  let sawDone = false;
  const handle = (data) => {
    let json;
    try {
      json = JSON.parse(data);
    } catch {
      throw new LlmError(
        "BAD_RESPONSE",
        "The language model returned an unexpected response.",
      );
    }
    if (json?.error) throw midStreamError(json);
    const choice = json?.choices?.[0];
    const piece = choice?.delta?.content;
    if (typeof piece === "string" && piece !== "") {
      text += piece;
      onToken(piece);
    }
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    usage = toUsage(json?.usage ?? json?.x_groq?.usage) ?? usage;
  };

  try {
    arm(o.timeoutMs); // until response headers arrive
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildStreamBody(model, messages)),
      signal: controller.signal,
    });
    if (!res.ok) {
      let json = null;
      try {
        json = JSON.parse(await res.text());
      } catch {
        // non-JSON body
      }
      throw classify(res.status, res.headers, json);
    }
    if (!res.body)
      throw new LlmError(
        "BAD_RESPONSE",
        "The language model returned an unexpected response.",
      );
    const parser = createSseParser({
      onData: handle,
      onDone: () => {
        sawDone = true;
      },
    });
    const decoder = new TextDecoder("utf-8");
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      arm(o.idleMs);
      parser.feed(decoder.decode(value, { stream: true }));
    }
    parser.feed(decoder.decode());
    parser.end();
  } catch (err) {
    if (err instanceof LlmError) throw err;
    if (signal?.aborted) throw cancelled();
    if (timedOut)
      throw new LlmError("TIMEOUT", "Language model request timed out.");
    // Discard err: it could carry request details.
    throw new LlmError(
      "UPSTREAM_ERROR",
      "Could not reach the language model service.",
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    controller.abort(); // closes the connection if anything is still open
  }

  // Success needs BOTH the terminator and a normal finish_reason.
  if (!sawDone || finishReason === null)
    throw new LlmError(
      "UPSTREAM_ERROR",
      "The language model stream ended early.",
    );
  if (finishReason === "length")
    throw new LlmError(
      "BAD_RESPONSE",
      "The language model stopped before finishing its answer.",
      { truncated: true },
    );
  if (finishReason !== "stop")
    throw new LlmError(
      "UPSTREAM_ERROR",
      "The language model stream ended abnormally.",
    );
  if (text.trim() === "")
    throw new LlmError(
      "BAD_RESPONSE",
      "The language model returned an unexpected response.",
    );
  return { text: text.trim(), model, usage };
}

// Streams the answer through onToken(delta). Falls back once to the fallback model only on
// RATE_LIMITED / MODEL_UNAVAILABLE BEFORE any token was emitted. After the first token any
// failure is thrown as an LlmError (code ABORTED when the signal fired).
// Returns { text, model, usedFallback, usage }. No retries (a retry would repeat sent tokens).
export async function generateStream(
  { messages, signal, onToken = () => {} },
  options = {},
) {
  if (!Array.isArray(messages) || messages.length === 0)
    throw new TypeError("messages must be a non-empty array");
  const o = {
    timeoutMs: REQUEST_TIMEOUT_MS,
    idleMs: STREAM_IDLE_MS,
    ...options,
  };
  const primary = config.GROQ_MODEL;
  const fallback = config.GROQ_FALLBACK_MODEL;
  let emitted = false;
  const tap = (t) => {
    emitted = true;
    onToken(t);
  };
  try {
    const r = await streamOnce({
      messages,
      model: primary,
      signal,
      onToken: tap,
      o,
    });
    return { ...r, usedFallback: false };
  } catch (err) {
    if (
      emitted ||
      !(err instanceof LlmError) ||
      !FALLBACK_ON.has(err.code) ||
      fallback === primary
    )
      throw err;
    const r = await streamOnce({
      messages,
      model: fallback,
      signal,
      onToken: tap,
      o,
    });
    return { ...r, usedFallback: true };
  }
}
