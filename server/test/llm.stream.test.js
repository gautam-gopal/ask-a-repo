import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { config } from "../src/config.js";
import {
  createSseParser,
  generateStream,
  LlmError,
  buildStreamBody,
} from "../src/services/llm.js";

const KEY = config.GROQ_API_KEY;
const MSGS = [{ role: "user", content: "q" }];
const enc = new TextEncoder();
let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const chunk = (delta, finish = null, extra = {}) =>
  `data: ${JSON.stringify({ choices: [{ delta, finish_reason: finish }], ...extra })}\n\n`;
const sse = (str, size = 0) => {
  const bytes = enc.encode(str);
  const parts = [];
  if (size)
    for (let i = 0; i < bytes.length; i += size)
      parts.push(bytes.slice(i, i + size));
  else parts.push(bytes);
  return new Response(
    new ReadableStream({
      start(c) {
        for (const p of parts) c.enqueue(p);
        c.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
};
const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers });
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

const GOOD = [
  chunk({ role: "assistant" }),
  chunk({ reasoning: "thinking" }),
  ": ping\n\n",
  chunk({ content: "Hel" }),
  chunk({ content: "lo é" }),
  chunk({}, "stop", {
    x_groq: {
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    },
  }),
  "data: [DONE]\n\n",
].join("");

describe("createSseParser", () => {
  const run = (pieces) => {
    const out = { data: [], done: 0 };
    const p = createSseParser({
      onData: (d) => out.data.push(d),
      onDone: () => out.done++,
    });
    for (const x of pieces) p.feed(x);
    p.end();
    return out;
  };

  it("joins a data line split across chunks", () => {
    expect(run(["da", "ta: hel", "lo\n", "\n"]).data).toEqual(["hello"]);
  });
  it("recognises [DONE] split across chunks", () => {
    const r = run(["data: a\n\ndata: [DO", "NE]\n\n"]);
    expect(r).toEqual({ data: ["a"], done: 1 });
  });
  it("ignores comments, blank lines and unknown fields", () => {
    expect(run([": c\n\n\n\nevent: x\nid: 1\ndata: ok\n\n"]).data).toEqual([
      "ok",
    ]);
  });
  it("joins multi-line data with LF", () => {
    expect(run(["data: a\ndata: b\n\n"]).data).toEqual(["a\nb"]);
  });
  it("handles CRLF even when \\r and \\n arrive in different chunks", () => {
    expect(run(["data: x\r", "\n\r", "\ndata: y\r\n\r\n"]).data).toEqual([
      "x",
      "y",
    ]);
  });
  it("flushes a final event with no trailing blank line", () => {
    expect(run(["data: tail"]).data).toEqual(["tail"]);
  });
});

describe("generateStream", () => {
  it.each([[0], [1], [3], [7]])(
    "forwards only content deltas, chunk size %i bytes",
    async (size) => {
      fetchMock.mockImplementation(async () => sse(GOOD, size));
      const tokens = [];
      const r = await generateStream({
        messages: MSGS,
        onToken: (t) => tokens.push(t),
      });
      expect(tokens).toEqual(["Hel", "lo é"]);
      expect(r).toEqual({
        text: "Hello é",
        model: config.GROQ_MODEL,
        usedFallback: false,
        usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 },
      });
      expect(tokens.join("")).not.toContain("thinking");
    },
  );

  it("handles CRLF line endings", async () => {
    fetchMock.mockImplementation(async () =>
      sse(GOOD.replaceAll("\n", "\r\n"), 5),
    );
    const r = await generateStream({ messages: MSGS });
    expect(r.text).toBe("Hello é");
  });

  it("sends stream:true and the bearer key", async () => {
    fetchMock.mockImplementation(async () => sse(GOOD));
    await generateStream({ messages: MSGS });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(bodyOf(0)).toMatchObject({
      model: config.GROQ_MODEL,
      stream: true,
      temperature: 0.1,
    });
    expect(bodyOf(0).max_completion_tokens).toBeGreaterThan(0);
  });

  it("falls back once on 429 before the first token", async () => {
    fetchMock
      .mockResolvedValueOnce(json({}, 429, { "retry-after": "5" }))
      .mockImplementationOnce(async () => sse(GOOD));
    const r = await generateStream({ messages: MSGS });
    expect(r.usedFallback).toBe(true);
    expect(r.model).toBe(config.GROQ_FALLBACK_MODEL);
    expect(bodyOf(1).model).toBe(config.GROQ_FALLBACK_MODEL);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back when the model is unavailable (404) before the first token", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ error: { code: "model_not_found" } }, 404))
      .mockImplementationOnce(async () => sse(GOOD));
    expect((await generateStream({ messages: MSGS })).usedFallback).toBe(true);
  });

  it("never switches models after a token was sent", async () => {
    fetchMock.mockImplementation(async () =>
      sse(
        chunk({ content: "Hi" }) +
          `data: ${JSON.stringify({ error: { code: "rate_limit_exceeded", message: `LEAK ${KEY}` } })}\n\n`,
      ),
    );
    const tokens = [];
    const err = await failure(
      generateStream({ messages: MSGS, onToken: (t) => tokens.push(t) }),
    );
    expect(err.code).toBe("RATE_LIMITED");
    expect(tokens).toEqual(["Hi"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify({ m: err.message, d: err.details })).not.toContain(
      KEY,
    );
  });

  it("a stream that ends without [DONE] or finish_reason is UPSTREAM_ERROR", async () => {
    fetchMock.mockImplementation(async () => sse(chunk({ content: "Hi" })));
    const err = await failure(generateStream({ messages: MSGS }));
    expect(err.code).toBe("UPSTREAM_ERROR");
  });

  it("only reasoning and no content is BAD_RESPONSE", async () => {
    fetchMock.mockImplementation(async () =>
      sse(chunk({ reasoning: "x" }) + chunk({}, "length") + "data: [DONE]\n\n"),
    );
    const err = await failure(generateStream({ messages: MSGS }));
    expect(err.code).toBe("BAD_RESPONSE");
  });

  it("does not fall back on AUTH_FAILED and never leaks the key", async () => {
    fetchMock.mockImplementation(async () =>
      json({ error: { message: `bad ${KEY}`, code: "x" } }, 401),
    );
    const err = await failure(generateStream({ messages: MSGS }));
    expect(err.code).toBe("AUTH_FAILED");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      JSON.stringify({ m: err.message, d: err.details, s: err.stack }),
    ).not.toContain(KEY);
  });

  it("aborting mid-stream rejects with ABORTED", async () => {
    fetchMock.mockImplementation(
      async (_u, init) =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(enc.encode(chunk({ content: "Hi" })));
              init.signal.addEventListener("abort", () =>
                c.error(new DOMException("aborted", "AbortError")),
              );
            },
          }),
        ),
    );
    const ctrl = new AbortController();
    const err = await failure(
      generateStream({
        messages: MSGS,
        signal: ctrl.signal,
        onToken: () => ctrl.abort(),
      }),
    );
    expect(err.code).toBe("ABORTED");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("an already-aborted signal never calls Groq", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const err = await failure(
      generateStream({ messages: MSGS, signal: ctrl.signal }),
    );
    expect(err.code).toBe("ABORTED");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("completion detection (regression)", () => {
  const ok = (extra = "") =>
    chunk({ content: "Hi" }) + chunk({}, "stop") + extra;

  it("finish_reason without [DONE] is incomplete", async () => {
    fetchMock.mockImplementation(async () => sse(ok()));
    expect((await failure(generateStream({ messages: MSGS }))).code).toBe(
      "UPSTREAM_ERROR",
    );
  });

  it("[DONE] without finish_reason is incomplete", async () => {
    fetchMock.mockImplementation(async () =>
      sse(chunk({ content: "Hi" }) + "data: [DONE]\n\n"),
    );
    expect((await failure(generateStream({ messages: MSGS }))).code).toBe(
      "UPSTREAM_ERROR",
    );
  });

  it("finish_reason length is rejected even with content", async () => {
    fetchMock.mockImplementation(async () =>
      sse(chunk({ content: "Hi" }) + chunk({}, "length") + "data: [DONE]\n\n"),
    );
    expect((await failure(generateStream({ messages: MSGS }))).code).toBe(
      "BAD_RESPONSE",
    );
  });

  it("a connection reset mid-stream is UPSTREAM_ERROR and keeps no key", async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(enc.encode(chunk({ content: "Hi" }) + 'data: {"choi'));
              setTimeout(() => c.error(new TypeError(`terminated ${KEY}`)), 10);
            },
          }),
        ),
    );
    const tokens = [];
    const err = await failure(
      generateStream({ messages: MSGS, onToken: (t) => tokens.push(t) }),
    );
    expect(err.code).toBe("UPSTREAM_ERROR");
    expect(tokens).toEqual(["Hi"]);
    expect(fetchMock).toHaveBeenCalledTimes(1); // no fallback after a token
    expect(JSON.stringify({ m: err.message, d: err.details })).not.toContain(
      KEY,
    );
  });

  it("a truncated final data line is not a success", async () => {
    fetchMock.mockImplementation(async () =>
      sse(chunk({ content: "Hi" }) + chunk({}, "stop") + "data: [DO"),
    );
    expect((await failure(generateStream({ messages: MSGS }))).code).toBe(
      "BAD_RESPONSE",
    );
  });
});

describe("usage and request options", () => {
  it("reads usage from a final chunk with empty choices", async () => {
    const usageChunk = `data: ${JSON.stringify({
      choices: [],
      x_groq: {
        usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
      },
    })}\n\n`;
    fetchMock.mockImplementation(async () =>
      sse(
        chunk({ content: "Hi" }) +
          chunk({}, "stop") +
          usageChunk +
          "data: [DONE]\n\n",
      ),
    );
    const r = await generateStream({ messages: MSGS });
    expect(r.usage).toEqual({
      promptTokens: 7,
      completionTokens: 3,
      totalTokens: 10,
    });
  });

  it("missing usage never fails an otherwise good answer", async () => {
    fetchMock.mockImplementation(async () =>
      sse(chunk({ content: "Hi" }) + chunk({}, "stop") + "data: [DONE]\n\n"),
    );
    const r = await generateStream({ messages: MSGS });
    expect(r).toMatchObject({ text: "Hi", usage: null });
  });

  it("sends include_usage, and reasoning controls for gpt-oss only", async () => {
    fetchMock.mockImplementation(async () => sse(GOOD));
    await generateStream({ messages: MSGS });
    expect(bodyOf(0)).toMatchObject({
      stream_options: { include_usage: true },
      include_reasoning: false,
      reasoning_effort: "low",
    });
    const other = buildStreamBody("some/other-model", MSGS);
    expect(other.include_reasoning).toBeUndefined();
    expect(other.reasoning_effort).toBeUndefined();
    expect(other.stream_options).toEqual({ include_usage: true });
  });
});
