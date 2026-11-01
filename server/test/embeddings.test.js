import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { config } from "../src/config.js";
import {
  embedDocuments,
  embedQuery,
  getUsage,
  resetUsage,
  EmbeddingError,
  MAX_RETRY_AFTER_MS,
} from "../src/services/embeddings.js";

const DIMS = config.EMBEDDING_DIMENSIONS;
const TOKEN = config.CLOUDFLARE_API_TOKEN;
const ACCOUNT = config.CLOUDFLARE_ACCOUNT_ID;

let fetchMock;
let sleep;
let FAST;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  sleep = vi.fn(async () => {});
  FAST = { sleep, backoffMs: 1 };
  resetUsage();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const vec = (fill, len = DIMS) => Array.from({ length: len }, () => fill);
const okBody = (data) => ({
  result: { shape: [data.length, DIMS], data, pooling: "cls" },
  success: true,
  errors: [],
  messages: [],
});
const ok = (data) => json(okBody(data));
const bodyOf = (call) => JSON.parse(call[1].body);

// Echoes one vector per input text; the vector is filled with the number in "t<N>".
const echo = async (_url, init) => {
  const { text } = JSON.parse(init.body);
  return ok(text.map((t) => vec(Number(String(t).replace(/\D/g, "")))));
};

async function failure(promise) {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(EmbeddingError);
    return err;
  }
  throw new Error("expected the promise to reject");
}

describe("embedDocuments", () => {
  it("keeps input order across batches and sends the expected request", async () => {
    fetchMock.mockImplementation(async (url, init) => {
      const { text } = JSON.parse(init.body);
      await new Promise((r) => setTimeout(r, text[0] === "t0" ? 30 : 1));
      return echo(url, init);
    });
    const texts = ["t0", "t1", "t2", "t3", "t4"];
    const out = await embedDocuments(texts, { ...FAST, batchSize: 2 });
    expect(out.map((v) => v[0])).toEqual([0, 1, 2, 3, 4]);
    expect(fetchMock.mock.calls.map((c) => bodyOf(c).text.length)).toEqual([
      2, 2, 1,
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/${config.EMBEDDING_MODEL}`,
    );
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(bodyOf(fetchMock.mock.calls[0]).pooling).toBe("cls");
  });

  it("returns [] for no input without calling Cloudflare", async () => {
    expect(await embedDocuments([])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects non-array, non-string and blank inputs", async () => {
    await expect(embedDocuments("x")).rejects.toThrow(TypeError);
    await expect(embedDocuments([1])).rejects.toThrow(TypeError);
    await expect(embedDocuments(["ok", "  "])).rejects.toThrow(TypeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retries a 429 and then succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ success: false, errors: [] }, 429))
      .mockImplementationOnce(echo);
    const out = await embedDocuments(["t1"], FAST);
    expect(out[0][0]).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("honours Retry-After", async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({ success: false, errors: [] }, 429, { "retry-after": "7" }),
      )
      .mockImplementationOnce(echo);
    await embedDocuments(["t1"], FAST);
    expect(sleep).toHaveBeenCalledWith(7000);
  });

  it("fails fast when Retry-After exceeds the cap", async () => {
    const secs = String(MAX_RETRY_AFTER_MS / 1000 + 60);
    fetchMock.mockImplementation(async () =>
      json({ success: false, errors: [] }, 429, { "retry-after": secs }),
    );
    const err = await failure(embedDocuments(["t1"], FAST));
    expect(err.code).toBe("RATE_LIMITED");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries a network error and then succeeds", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockImplementationOnce(echo);
    const out = await embedDocuments(["t3"], FAST);
    expect(out[0][0]).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after 3 retries (4 calls) on a persistent 5xx", async () => {
    fetchMock.mockImplementation(async () => json({}, 503));
    const err = await failure(embedDocuments(["t1"], FAST));
    expect(err.code).toBe("UPSTREAM_ERROR");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it("times out and reports TIMEOUT after retrying", async () => {
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        }),
    );
    const err = await failure(
      embedDocuments(["t1"], { ...FAST, timeoutMs: 10, maxRetries: 1 }),
    );
    expect(err.code).toBe("TIMEOUT");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("BAD_RESPONSE when result.data is missing", async () => {
    fetchMock.mockImplementation(async () =>
      json({ success: true, result: {} }),
    );
    const err = await failure(embedDocuments(["t1"], FAST));
    expect(err.code).toBe("BAD_RESPONSE");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("BAD_RESPONSE on a vector count mismatch", async () => {
    fetchMock.mockImplementation(async () => ok([vec(1)]));
    const err = await failure(embedDocuments(["t1", "t2"], FAST));
    expect(err.code).toBe("BAD_RESPONSE");
  });

  it("BAD_RESPONSE on a non-JSON 200 body", async () => {
    fetchMock.mockImplementation(
      async () => new Response("<html>oops</html>", { status: 200 }),
    );
    const err = await failure(embedDocuments(["t1"], FAST));
    expect(err.code).toBe("BAD_RESPONSE");
  });

  it("DIMENSION_MISMATCH on a wrong vector length", async () => {
    fetchMock.mockImplementation(async () => ok([vec(1, DIMS - 1)]));
    const err = await failure(embedDocuments(["t1"], FAST));
    expect(err.code).toBe("DIMENSION_MISMATCH");
    expect(err.details).toMatchObject({ expected: DIMS, got: DIMS - 1 });
  });

  it("QUOTA_EXHAUSTED (code 3036) is not retried", async () => {
    fetchMock.mockImplementation(async () =>
      json(
        {
          success: false,
          errors: [{ code: 3036, message: "daily free allocation used" }],
        },
        429,
      ),
    );
    const err = await failure(embedDocuments(["t1"], FAST));
    expect(err.code).toBe("QUOTA_EXHAUSTED");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("a plain 429 without code 3036 stays RATE_LIMITED and is retried", async () => {
    fetchMock.mockImplementation(async () =>
      json({ success: false, errors: [{ code: 9999, message: "slow" }] }, 429),
    );
    const err = await failure(embedDocuments(["t1"], FAST));
    expect(err.code).toBe("RATE_LIMITED");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("maps HTTP 408 (code 3007) to TIMEOUT, retries, then succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({ success: false, errors: [{ code: 3007, message: "x" }] }, 408),
      )
      .mockImplementationOnce(echo);
    const out = await embedDocuments(["t2"], FAST);
    expect(out[0][0]).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("persistent 408 (code 3008) ends as TIMEOUT after 4 calls", async () => {
    fetchMock.mockImplementation(async () =>
      json({ success: false, errors: [{ code: 3008, message: "x" }] }, 408),
    );
    const err = await failure(embedDocuments(["t1"], FAST));
    expect(err.code).toBe("TIMEOUT");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("AUTH_FAILED on 401 is not retried", async () => {
    fetchMock.mockImplementation(async () =>
      json({ success: false, errors: [{ code: 10000, message: "x" }] }, 401),
    );
    const err = await failure(embedDocuments(["t1"], FAST));
    expect(err.code).toBe("AUTH_FAILED");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("errors never contain secrets", () => {
  const leaky = `bad ${TOKEN} ${ACCOUNT}`;
  it.each([
    [
      "401",
      async () =>
        json(
          { success: false, errors: [{ code: 10000, message: leaky }] },
          401,
        ),
    ],
    [
      "429 exhausted",
      async () =>
        json({ success: false, errors: [{ code: 1, message: leaky }] }, 429),
    ],
    [
      "500",
      async () =>
        json({ success: false, errors: [{ code: 2, message: leaky }] }, 500),
    ],
    [
      "quota",
      async () =>
        json({ success: false, errors: [{ code: 3036, message: leaky }] }, 429),
    ],
    [
      "network error",
      async () => {
        throw new Error(`boom ${leaky}`);
      },
    ],
  ])("%s", async (_name, impl) => {
    fetchMock.mockImplementation(impl);
    const err = await failure(
      embedDocuments(["t1"], { ...FAST, maxRetries: 1 }),
    );
    const dump = JSON.stringify({
      message: err.message,
      details: err.details,
      stack: err.stack,
    });
    expect(dump).not.toContain(TOKEN);
    expect(dump).not.toContain(ACCOUNT);
  });
});

describe("usage estimate", () => {
  it("counts requests, estimated tokens (chars/4) and truncation risk", async () => {
    fetchMock.mockImplementation(async (_u, init) =>
      ok(JSON.parse(init.body).text.map(() => vec(1))),
    );
    await embedDocuments(["abcd", "abcde", "x".repeat(2000)], FAST);
    const u = getUsage();
    expect(u.requests).toBe(1);
    expect(u.inputs).toBe(3);
    expect(u.estTokens).toBe(1 + 2 + 500);
    expect(u.truncationRisk).toBe(1);
    expect(u.estNeurons).toBeCloseTo(((1 + 2 + 500) / 1e6) * 6058, 1);
    expect(u.isEstimate).toBe(true);
  });
  it("requests counts HTTP attempts including retries; batches counts successes", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ success: false, errors: [] }, 503))
      .mockResolvedValueOnce(json({ success: false, errors: [] }, 429))
      .mockImplementationOnce(echo);
    await embedDocuments(["t1"], FAST);
    const u = getUsage();
    expect(u.requests).toBe(3);
    expect(u.batches).toBe(1);
    expect(u.inputs).toBe(1);
  });
});

describe("embedQuery", () => {
  it("sends no prefix by default and returns a single vector", async () => {
    fetchMock.mockImplementation(async () => ok([vec(2)]));
    const v = await embedQuery("where is auth", FAST);
    expect(v).toHaveLength(DIMS);
    expect(bodyOf(fetchMock.mock.calls[0]).text).toEqual(["where is auth"]);
  });

  it("adds the BGE instruction prefix when enabled", async () => {
    fetchMock.mockImplementation(async () => ok([vec(2)]));
    await embedQuery("where is auth", { ...FAST, queryPrefix: true });
    const [sent] = bodyOf(fetchMock.mock.calls[0]).text;
    expect(sent).toBe(
      "Represent this sentence for searching relevant passages: where is auth",
    );
  });
});
