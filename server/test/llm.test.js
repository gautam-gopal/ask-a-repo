import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { config } from "../src/config.js";
import { chat, generate, LlmError } from "../src/services/llm.js";

const KEY = config.GROQ_API_KEY;
const MSGS = [{ role: "user", content: "q" }];
let fetchMock;
let sleep;
let FAST;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  sleep = vi.fn(async () => {});
  FAST = { sleep, backoffMs: 1 };
});
afterEach(() => vi.unstubAllGlobals());

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const ok = (text = "hi") =>
  json({
    choices: [{ message: { content: text } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  });
const bodyOf = (i) => JSON.parse(fetchMock.mock.calls[i][1].body);
async function failure(promise) {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(LlmError);
    return err;
  }
  throw new Error("expected the promise to reject");
}

describe("generate", () => {
  it("succeeds on the primary model and sends the expected request", async () => {
    fetchMock.mockResolvedValueOnce(ok("answer"));
    const r = await generate({ messages: MSGS }, FAST);
    expect(r).toEqual({
      text: "answer",
      model: config.GROQ_MODEL,
      usedFallback: false,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(bodyOf(0)).toMatchObject({
      model: config.GROQ_MODEL,
      temperature: 0.1,
      messages: MSGS,
    });
    expect(bodyOf(0).max_completion_tokens).toBeGreaterThan(0);
    expect(bodyOf(0).max_tokens).toBeUndefined();
  });

  it("usage is null when the API reports none", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ choices: [{ message: { content: "x" } }] }),
    );
    expect((await generate({ messages: MSGS }, FAST)).usage).toBeNull();
  });

  it("falls back once on 429 and flags usedFallback", async () => {
    fetchMock
      .mockResolvedValueOnce(json({}, 429, { "retry-after": "5" }))
      .mockResolvedValueOnce(ok("small"));
    const r = await generate({ messages: MSGS }, FAST);
    expect(r.usedFallback).toBe(true);
    expect(r.model).toBe(config.GROQ_FALLBACK_MODEL);
    expect(bodyOf(1).model).toBe(config.GROQ_FALLBACK_MODEL);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back when the model is unavailable (404)", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ error: { code: "model_not_found" } }, 404))
      .mockResolvedValueOnce(ok());
    expect((await generate({ messages: MSGS }, FAST)).usedFallback).toBe(true);
  });

  it("429 on both models throws RATE_LIMITED with retryAfterSeconds", async () => {
    fetchMock
      .mockResolvedValueOnce(json({}, 429, { "retry-after": "5" }))
      .mockResolvedValueOnce(json({}, 429, { "retry-after": "12" }));
    const err = await failure(generate({ messages: MSGS }, FAST));
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.retryAfterSeconds).toBe(12);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not fall back on AUTH_FAILED", async () => {
    fetchMock.mockResolvedValue(json({}, 401));
    const err = await failure(generate({ messages: MSGS }, FAST));
    expect(err.code).toBe("AUTH_FAILED");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a 5xx then succeeds", async () => {
    fetchMock.mockResolvedValueOnce(json({}, 503)).mockResolvedValueOnce(ok());
    const r = await generate({ messages: MSGS }, FAST);
    expect(r.usedFallback).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("retries a network error then succeeds", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(ok());
    await generate({ messages: MSGS }, FAST);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after 2 retries (3 calls) on a persistent 5xx, no fallback", async () => {
    fetchMock.mockImplementation(async () => json({}, 502));
    const err = await failure(generate({ messages: MSGS }, FAST));
    expect(err.code).toBe("UPSTREAM_ERROR");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("times out without retrying", async () => {
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_res, rej) =>
          init.signal.addEventListener("abort", () =>
            rej(Object.assign(new Error("aborted"), { name: "AbortError" })),
          ),
        ),
    );
    const err = await failure(
      generate({ messages: MSGS }, { ...FAST, timeoutMs: 10 }),
    );
    expect(err.code).toBe("TIMEOUT");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["no choices", { choices: [] }],
    ["empty content", { choices: [{ message: { content: "  " } }] }],
    ["wrong shape", { hello: 1 }],
  ])("BAD_RESPONSE for %s, not retried", async (_n, body) => {
    fetchMock.mockImplementation(async () => json(body));
    const err = await failure(generate({ messages: MSGS }, FAST));
    expect(err.code).toBe("BAD_RESPONSE");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("chat rejects bad arguments without calling Groq", async () => {
    await expect(chat({ messages: [], model: "m" })).rejects.toThrow(TypeError);
    await expect(chat({ messages: MSGS, model: "" })).rejects.toThrow(
      TypeError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("errors never contain the key", () => {
  const leaky = `bad ${KEY}`;
  it.each([
    ["401", async () => json({ error: { message: leaky, code: "x" } }, 401)],
    ["429", async () => json({ error: { message: leaky } }, 429)],
    ["500", async () => json({ error: { message: leaky } }, 500)],
    [
      "network",
      async () => {
        throw new Error(`boom ${leaky}`);
      },
    ],
  ])("%s", async (_n, impl) => {
    fetchMock.mockImplementation(impl);
    const err = await failure(generate({ messages: MSGS }, FAST));
    const dump = JSON.stringify({
      message: err.message,
      details: err.details,
      stack: err.stack,
    });
    expect(dump).not.toContain(KEY);
  });
});
