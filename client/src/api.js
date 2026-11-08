import { parseSseStream } from "./sse.js";
// Same-origin fetch wrapper. All server calls go through request().
const WAKING_AFTER_MS = 4000;
const DEFAULT_TIMEOUT_MS = 75_000; // longer than a Render cold start

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "ApiError";
    this.status = status; // 0 for network failure or timeout
    this.code = code;
  }
}

let onUnauthorized = null;
let onWaking = null;
let slowCount = 0;
export const setUnauthorizedHandler = (fn) => {
  onUnauthorized = fn;
};
export const setWakingHandler = (fn) => {
  onWaking = fn;
};

async function request(
  method,
  path,
  {
    body,
    wakeHint = true,
    authRedirect = true,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = {},
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let slow = false;
  // Still pending after 4 s: tell the UI the server may be waking up.
  const slowTimer = wakeHint
    ? setTimeout(() => {
        slow = true;
        slowCount++;
        onWaking?.(true);
      }, WAKING_AFTER_MS)
    : null;

  try {
    let status;
    let text;
    try {
      const res = await fetch(path, {
        method,
        credentials: "same-origin",
        headers:
          body !== undefined
            ? { "Content-Type": "application/json" }
            : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      status = res.status;
      text = await res.text();
    } catch (err) {
      if (err?.name === "AbortError")
        throw new ApiError(0, "TIMEOUT", "The request timed out. Try again.");
      throw new ApiError(
        0,
        "NETWORK",
        "Cannot reach the server. Check your connection and try again.",
      );
    }

    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // non-JSON body (HTML error page from a proxy, for example)
    }

    if (status < 200 || status >= 300) {
      const e = data?.error;
      const err =
        typeof e?.code === "string" && typeof e?.message === "string"
          ? new ApiError(status, e.code, e.message)
          : new ApiError(
              status,
              "HTTP_ERROR",
              status >= 500
                ? "The server is unavailable. Try again in a moment."
                : `Unexpected response from the server (status ${status}).`,
            );
      if (status === 401 && authRedirect) onUnauthorized?.();
      throw err;
    }
    if (data === null)
      throw new ApiError(
        status,
        "BAD_RESPONSE",
        "The server sent an unexpected response.",
      );
    return data;
  } finally {
    clearTimeout(timeout);
    if (slowTimer) clearTimeout(slowTimer);
    if (slow) {
      slowCount--;
      if (slowCount === 0) onWaking?.(false);
    }
  }
}

// Auth. Login and signup 401s mean "wrong credentials", so they must not trigger the global logout.
export const signup = (email, password) =>
  request("POST", "/api/auth/signup", {
    body: { email, password },
    authRedirect: false,
  });
export const login = (email, password) =>
  request("POST", "/api/auth/login", {
    body: { email, password },
    authRedirect: false,
  });
export const logout = () => request("POST", "/api/auth/logout");
export const me = () => request("GET", "/api/me", { authRedirect: false });
export const getConfig = () =>
  request("GET", "/api/config", { authRedirect: false });
export const demoLogin = () =>
  request("POST", "/api/auth/demo", { authRedirect: false });

// Repos and ask (used from 8B and 8C).
const id = encodeURIComponent;
// Polls pass wakeHint: false so only the first load can show the "waking up" banner.
export const listRepos = ({ wakeHint = true } = {}) =>
  request("GET", "/api/repos", { wakeHint });
export const createRepo = (url) =>
  request("POST", "/api/repos", { body: { url } });
export const getRepo = (repoId) => request("GET", `/api/repos/${id(repoId)}`);
export const deleteRepo = (repoId) =>
  request("DELETE", `/api/repos/${id(repoId)}`);
export const listMessages = (repoId) =>
  request("GET", `/api/repos/${id(repoId)}/messages`);
// An LLM answer can take several seconds; that is not a cold start, so no waking hint.
export const askQuestion = (repoId, question) =>
  request("POST", `/api/repos/${id(repoId)}/ask`, {
    body: { question },
    wakeHint: false,
  });

// ---- Streaming ask (Phase 9B) ----
const STREAM_IDLE_MS = 45_000; // server heartbeat is every 15 s; 3 missed beats = dead

// Same "waking up" banner logic as request(): shown if no response headers after 4 s.
function trackSlow() {
  let slow = false;
  const t = setTimeout(() => {
    slow = true;
    slowCount++;
    onWaking?.(true);
  }, WAKING_AFTER_MS);
  return () => {
    clearTimeout(t);
    if (slow) {
      slow = false;
      slowCount--;
      if (slowCount === 0) onWaking?.(false);
    }
  };
}

function errorFromResponse(status, text) {
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON body
  }
  const e = data?.error;
  return typeof e?.code === "string" && typeof e?.message === "string"
    ? new ApiError(status, e.code, e.message)
    : new ApiError(
        status,
        "HTTP_ERROR",
        status >= 500
          ? "The server is unavailable. Try again in a moment."
          : `Unexpected response from the server (status ${status}).`,
      );
}

const STREAM_EVENTS = new Set(["sources", "token", "done", "error"]);

// POST /api/repos/:id/ask/stream. Calls onSources(sources[]), onToken(text), then exactly one of
// onDone(payload) or onError({ code, message }). Resolves after done or error.
// Rejects with ApiError: pre-stream JSON errors keep the server's status and code;
// ABORTED (signal fired), STREAM_INTERRUPTED (dropped or stalled or ended without done/error),
// TIMEOUT, NETWORK, BAD_RESPONSE.
export async function askStream({
  repoId,
  question,
  signal,
  onSources,
  onToken,
  onDone,
  onError,
}) {
  const aborted = () =>
    new ApiError(0, "ABORTED", "The request was cancelled.");
  if (signal?.aborted) throw aborted();

  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  let timer = null;
  let timedOut = false;
  const arm = (ms) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, ms);
  };
  const stopSlow = trackSlow();
  let finished = false;
  const fail = (started) => {
    if (signal?.aborted) return aborted();
    if (started)
      return new ApiError(
        0,
        "STREAM_INTERRUPTED",
        "The connection was interrupted before the answer finished.",
      );
    if (timedOut)
      return new ApiError(0, "TIMEOUT", "The request timed out. Try again.");
    return new ApiError(
      0,
      "NETWORK",
      "Cannot reach the server. Check your connection and try again.",
    );
  };
  const handle = ({ event, data }) => {
    if (!STREAM_EVENTS.has(event)) return; // unknown events are ignored
    let d;
    try {
      d = JSON.parse(data);
    } catch {
      throw new ApiError(
        0,
        "BAD_RESPONSE",
        "The server sent an unexpected response.",
      );
    }
    if (event === "sources")
      onSources?.(Array.isArray(d?.sources) ? d.sources : []);
    else if (event === "token") {
      if (typeof d?.t === "string") onToken?.(d.t);
    } else if (event === "done") {
      finished = true;
      onDone?.(d);
    } else {
      finished = true;
      onError?.({
        code: typeof d?.code === "string" ? d.code : "INTERNAL",
        message: typeof d?.message === "string" ? d.message : "",
      });
    }
  };
  const pump = (events) => {
    for (const ev of events) {
      handle(ev);
      if (finished) return;
    }
  };

  try {
    arm(DEFAULT_TIMEOUT_MS); // until response headers arrive
    let res;
    try {
      res = await fetch(`/api/repos/${id(repoId)}/ask/stream`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({ question }),
        signal: ctrl.signal,
      });
    } catch {
      throw fail(false);
    }
    stopSlow(); // first byte of the response has arrived

    if (!res.ok) {
      let text = "";
      try {
        text = await res.text();
      } catch {
        throw fail(false);
      }
      if (res.status === 401) onUnauthorized?.();
      throw errorFromResponse(res.status, text);
    }
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("text/event-stream") || !res.body)
      throw new ApiError(
        res.status,
        "BAD_RESPONSE",
        "The server sent an unexpected response.",
      );

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    const parser = parseSseStream();
    try {
      while (!finished) {
        arm(STREAM_IDLE_MS);
        const { done, value } = await reader.read();
        if (done) break;
        pump(parser.feed(decoder.decode(value, { stream: true })));
      }
      if (!finished) pump(parser.feed(decoder.decode()));
      if (!finished) pump(parser.end().events);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw fail(true);
    }
    if (!finished) throw fail(true);
  } finally {
    clearTimeout(timer);
    stopSlow();
    signal?.removeEventListener("abort", onAbort);
    ctrl.abort(); // closes the connection if anything is still open
  }
}
