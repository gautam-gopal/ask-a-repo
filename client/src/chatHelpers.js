// Pure helpers for the chat page. No imports, so the server's Vitest can test it too.

// Alternatives, in order: a code span or fence (passed through untouched), an ASCII [n] / [n, m]
// marker, a Unicode 【n】 / 【n, m】 marker. An ASCII marker right after a word character or ")"
// (items[7], f(x)[1]) is code, not a citation. Adjacent markers like [1][2] are allowed.
const CITE_RE =
  /(```[\s\S]*?```|`[^`\n]*`)|(?<![\w)])\[(\d+(?:\s*,\s*\d+)*)\]|【\s*(\d+(?:\s*,\s*\d+)*)\s*】/g;

// Returns [{ type: "text", text } | { type: "cite", n }]. Only numbers that exist in
// `sources` become cite segments. Anything else stays text (Unicode markers are normalised
// to [n]). The caller renders text as plain text; nothing here produces HTML.
export function linkifyCitations(answerText, sources) {
  if (typeof answerText !== "string" || answerText === "") return [];
  const valid = new Set(
    (Array.isArray(sources) ? sources : [])
      .map((s) => s?.n)
      .filter(Number.isInteger),
  );
  const out = [];
  const pushText = (t) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last?.type === "text") last.text += t;
    else out.push({ type: "text", text: t });
  };
  let pos = 0;
  for (const m of answerText.matchAll(CITE_RE)) {
    pushText(answerText.slice(pos, m.index));
    pos = m.index + m[0].length;
    if (m[1] !== undefined) {
      pushText(m[1]);
      continue;
    }
    const nums = (m[2] ?? m[3]).split(",").map((s) => Number(s.trim()));
    for (const n of nums) {
      if (valid.has(n)) out.push({ type: "cite", n });
      else pushText(`[${n}]`);
    }
  }
  pushText(answerText.slice(pos));
  return out;
}

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
