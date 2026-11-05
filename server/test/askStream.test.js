import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  askStream,
  ApiError,
  setUnauthorizedHandler,
} from "../../client/src/api.js";

const enc = new TextEncoder();
const frame = (event, data) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const sse = (text, size = 0) => {
  const bytes = enc.encode(text);
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
    {
      status: 200,
      headers: { "content-type": "text/event-stream; charset=utf-8" },
    },
  );
};
const json = (body, status) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const collect = () => {
  const log = [];
  return {
    log,
    cb: {
      onSources: (s) => log.push(["sources", s]),
      onToken: (t) => log.push(["token", t]),
      onDone: (d) => log.push(["done", d]),
      onError: (e) => log.push(["error", e]),
    },
  };
};
async function failure(promise) {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    return err;
  }
  throw new Error("expected the promise to reject");
}

let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  setUnauthorizedHandler(null);
});

const BODY =
  frame("sources", { sources: [{ n: 1 }] }) +
  ": keep-alive\n\n" +
  frame("whatever", { x: 1 }) +
  frame("token", { t: "Hé" }) +
  frame("token", { t: "llo ✓" }) +
  frame("done", { id: "m1", answer: "Héllo ✓", notFound: false, sources: [] });

describe("askStream", () => {
  it.each([[0], [1], [5]])(
    "delivers sources, tokens, done in order (chunk size %i), ignoring heartbeats and unknown events",
    async (size) => {
      fetchMock.mockImplementation(async () => sse(BODY, size));
      const { log, cb } = collect();
      await askStream({ repoId: "abc", question: "q", ...cb });
      expect(log.map((l) => l[0])).toEqual([
        "sources",
        "token",
        "token",
        "done",
      ]);
      expect(log[1][1] + log[2][1]).toBe("Héllo ✓");
      expect(log[3][1].id).toBe("m1");
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("/api/repos/abc/ask/stream");
      expect(init.method).toBe("POST");
      expect(init.credentials).toBe("same-origin");
      expect(JSON.parse(init.body)).toEqual({ question: "q" });
    },
  );

  it("an error event calls onError and resolves", async () => {
    fetchMock.mockImplementation(async () =>
      sse(
        frame("token", { t: "par" }) +
          frame("error", { code: "UPSTREAM_TIMEOUT", message: "slow" }),
      ),
    );
    const { log, cb } = collect();
    await askStream({ repoId: "abc", question: "q", ...cb });
    expect(log.at(-1)).toEqual([
      "error",
      { code: "UPSTREAM_TIMEOUT", message: "slow" },
    ]);
  });

  it("pre-stream JSON errors become ApiErrors", async () => {
    fetchMock.mockResolvedValue(
      json({ error: { code: "REPO_NOT_READY", message: "not ready" } }, 409),
    );
    const err = await failure(
      askStream({ repoId: "abc", question: "q", ...collect().cb }),
    );
    expect([err.status, err.code]).toEqual([409, "REPO_NOT_READY"]);
  });

  it("a 401 triggers the unauthorized handler", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    fetchMock.mockResolvedValue(
      json({ error: { code: "UNAUTHENTICATED", message: "no" } }, 401),
    );
    await failure(askStream({ repoId: "abc", question: "q", ...collect().cb }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("a 200 that is not an event stream is BAD_RESPONSE", async () => {
    fetchMock.mockResolvedValue(json({ ok: true }, 200));
    const err = await failure(
      askStream({ repoId: "abc", question: "q", ...collect().cb }),
    );
    expect(err.code).toBe("BAD_RESPONSE");
  });

  it("a stream that ends without done or error is STREAM_INTERRUPTED, tokens kept", async () => {
    fetchMock.mockImplementation(async () =>
      sse(frame("sources", { sources: [] }) + frame("token", { t: "Hi" })),
    );
    const { log, cb } = collect();
    const err = await failure(
      askStream({ repoId: "abc", question: "q", ...cb }),
    );
    expect(err.code).toBe("STREAM_INTERRUPTED");
    expect(log.filter((l) => l[0] === "token")).toEqual([["token", "Hi"]]);
  });

  it("a final partial frame is not treated as done", async () => {
    fetchMock.mockImplementation(async () =>
      sse(frame("token", { t: "Hi" }) + 'event: done\ndata: {"id":"x"'),
    );
    const { log, cb } = collect();
    const err = await failure(
      askStream({ repoId: "abc", question: "q", ...cb }),
    );
    expect(err.code).toBe("STREAM_INTERRUPTED");
    expect(log.some((l) => l[0] === "done")).toBe(false);
  });

  it("aborting mid-stream rejects with ABORTED", async () => {
    fetchMock.mockImplementation(
      async (_u, init) =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(enc.encode(frame("token", { t: "Hi" })));
              init.signal.addEventListener("abort", () =>
                c.error(new DOMException("aborted", "AbortError")),
              );
            },
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        ),
    );
    const ctrl = new AbortController();
    const { cb } = collect();
    const err = await failure(
      askStream({
        repoId: "abc",
        question: "q",
        signal: ctrl.signal,
        ...cb,
        onToken: () => ctrl.abort(),
      }),
    );
    expect(err.code).toBe("ABORTED");
  });

  it("an already-aborted signal never calls fetch", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const err = await failure(
      askStream({ repoId: "abc", question: "q", signal: ctrl.signal }),
    );
    expect(err.code).toBe("ABORTED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a network failure before any response is NETWORK", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const err = await failure(
      askStream({ repoId: "abc", question: "q", ...collect().cb }),
    );
    expect(err.code).toBe("NETWORK");
  });
});
