// Pure helpers for the chat page. No imports, so the server's Vitest can test it too.

// Cited sources first, then by number. Does not mutate the input.
export function orderSources(sources) {
  if (!Array.isArray(sources)) return [];
  return [...sources].sort(
    (a, b) => (b.cited === true) - (a.cited === true) || a.n - b.n,
  );
}

// Only real GitHub URLs become links (blocks javascript:, data:, lookalike hosts).
export const isGithubUrl = (url) =>
  typeof url === "string" && url.startsWith("https://github.com/");

const ASK_MESSAGES = {
  VALIDATION_ERROR: "Enter a question of 1 to 500 characters.",
  QUOTA_EXHAUSTED:
    "The daily embedding allowance is used up. It resets at midnight UTC. Try again later.",
  EMBEDDING_RATE_LIMITED:
    "The service is busy. Wait about a minute, then press Send again.",
  LLM_RATE_LIMITED:
    "The language model is busy. Wait about a minute, then press Send again.",
  UPSTREAM_TIMEOUT: "The request took too long. Press Send to try again.",
  STREAM_INTERRUPTED:
    "The connection was interrupted before the answer finished. Press Send to try again.",
  ANSWER_TOO_LONG:
    "The answer was too long to finish. Try a narrower question, for example about one file or function.",
  ANSWER_FAILED: "Answering failed on the server. Press Send to try again.",
  EMBEDDING_FAILED: "Search failed on the server. Press Send to try again.",
  REPO_NOT_READY:
    "This repository is not ready yet. Go back to the list and wait until it shows Ready.",
  REPO_NOT_FOUND: "This repository no longer exists.",
  INTERNAL: "Something went wrong on the server. Try again.",
};

export function formatAskError(err) {
  const code = err?.code;
  if (typeof code === "string" && Object.hasOwn(ASK_MESSAGES, code))
    return ASK_MESSAGES[code];
  if (typeof err?.message === "string" && err.message) return err.message;
  return "Something went wrong. Try again.";
}

export const EXAMPLE_QUESTIONS = [
  "What does this project do?",
  "Where is authentication handled?",
  "How is the project structured?",
];

// Keeps the start and (more of) the end, so the file name survives. Result length <= max.
export function middleTruncate(text, max = 40) {
  if (typeof text !== "string") return "";
  const limit = Math.max(3, Math.floor(max));
  if (text.length <= limit) return text;
  const keep = limit - 1;
  const tail = Math.ceil(keep * 0.6);
  const head = keep - tail;
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}

// Cited first (orderSources), plus the counts for the toggle label.
export function summarizeSources(sources) {
  const list = orderSources(sources);
  const total = list.length;
  const cited = list.filter((s) => s.cited === true).length;
  const label =
    total === 0
      ? "No sources"
      : `${total} ${total === 1 ? "source" : "sources"}, ${cited} cited`;
  return { list, total, cited, label };
}

const OWNER_RE = /^[A-Za-z0-9-]{1,39}$/;
const NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;

// Links are built only from validated parts, so a bad value yields null, never a link.
export function githubRepoUrl(repo) {
  const owner = repo?.owner;
  const name = repo?.name;
  if (typeof owner !== "string" || typeof name !== "string") return null;
  if (!OWNER_RE.test(owner) || !NAME_RE.test(name)) return null;
  if (name === "." || name === "..") return null;
  return `https://github.com/${owner}/${name}`;
}

export function githubCommitUrl(repo) {
  const base = githubRepoUrl(repo);
  const sha = repo?.commitSha;
  return base && typeof sha === "string" && /^[0-9a-f]{40}$/.test(sha)
    ? `${base}/commit/${sha}`
    : null;
}

export function formatTime(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
