// Pure helpers for the repos page. No imports, so the server's Vitest can test it too.
const LABELS = {
  queued: "Queued",
  indexing: "Indexing",
  ready: "Ready",
  failed: "Failed",
};

export const statusLabel = (status) => LABELS[status] ?? "Unknown";
export const isActive = (status) =>
  status === "queued" || status === "indexing";

// Whole percent, clamped to 0..100. Floor, so 99.6% never shows as 100 before it is done.
export function progressPercent(progress) {
  const done = Number(progress?.embedded);
  const total = Number(progress?.total);
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.floor((done / total) * 100)));
}

// Messages for the add-repository form, keyed by server error code.
const ADD_MESSAGES = {
  INVALID_URL:
    "That is not a valid repository URL. Use the form https://github.com/owner/name.",
  VALIDATION_ERROR: "Enter a GitHub repository URL (up to 200 characters).",
  REPO_EXISTS: "This repository is already in your list.",
  INGEST_IN_PROGRESS:
    "Another repository is still being indexed. Wait for it to finish, then try again.",
  REPO_LIMIT_REACHED: "You can have at most 3 repositories. Delete one first.",
  BUSY: "The server is indexing other repositories right now. Try again in about a minute.",
};

export function formatError(err) {
  const code = err?.code;
  if (typeof code === "string" && Object.hasOwn(ADD_MESSAGES, code))
    return ADD_MESSAGES[code];
  if (typeof err?.message === "string" && err.message) return err.message;
  return "Something went wrong. Try again.";
}

export function formatCreated(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
}
