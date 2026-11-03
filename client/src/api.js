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

// Repos and ask (used from 8B and 8C).
const id = encodeURIComponent;
export const listRepos = () => request("GET", "/api/repos");
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
