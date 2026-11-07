import { config } from "./config.js";

// Exact secret values from config (short ones skipped to avoid mangling normal text), then patterns.
const SECRETS = [
  config.JWT_SECRET,
  config.GITHUB_TOKEN,
  config.CLOUDFLARE_API_TOKEN,
  config.CLOUDFLARE_ACCOUNT_ID,
  config.GROQ_API_KEY,
].filter((s) => typeof s === "string" && s.length >= 8);

const PATTERNS = [
  [/mongodb(?:\+srv)?:\/\/[^\s"'`]+/gi, "mongodb://[redacted]"],
  [/Bearer\s+[A-Za-z0-9._~+\/=-]+/gi, "Bearer [redacted]"],
  [/\b(token|jwt|api[_-]?key|password|secret)=([^\s&;"']+)/gi, "$1=[redacted]"],
  [
    /("(?:password|token|secret|authorization|cookie)"\s*:\s*)"[^"]*"/gi,
    '$1"[redacted]"',
  ],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
];

export function redact(input) {
  let s;
  if (typeof input === "string") s = input;
  else if (input instanceof Error) s = input.stack ?? input.message;
  else {
    try {
      s = JSON.stringify(input) ?? String(input);
    } catch {
      s = String(input);
    }
  }
  for (const secret of SECRETS) s = s.split(secret).join("[redacted]");
  for (const [re, to] of PATTERNS) s = s.replace(re, to);
  return s;
}
