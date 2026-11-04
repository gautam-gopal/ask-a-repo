// Reads the SSE ask stream from a running server. Spends Groq quota, so it needs --yes.
// Auth: set ASK_COOKIE="token=<jwt>" (see the curl login in the Verify section).
// Optional: BASE_URL (default http://localhost:3000).
const args = process.argv.slice(2);
const yes = args.includes("--yes");
const [repoId, question] = args.filter((a) => !a.startsWith("--"));
const base = process.env.BASE_URL ?? "http://localhost:3000";
const cookie = process.env.ASK_COOKIE;

if (!repoId || !question) {
  console.error(
    'Usage: ASK_COOKIE="token=..." node server/scripts/ask-stream-test.js <repoId> "<question>" --yes',
  );
  process.exit(1);
}
if (!yes) {
  console.log(
    "This spends 1 Cloudflare embedding call and up to 1 Groq request (2 on fallback).",
  );
  console.log("Not started. Re-run with --yes.");
  process.exit(0);
}
if (!cookie) {
  console.error('Set ASK_COOKIE="token=<jwt>" first.');
  process.exit(1);
}

const t0 = Date.now();
const ms = () => `+${String(Date.now() - t0).padStart(5)}ms`;
let firstToken = null;
let tokens = 0;
let text = "";

const res = await fetch(
  `${base}/api/repos/${encodeURIComponent(repoId)}/ask/stream`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ question }),
  },
);
console.log(`${ms()}  HTTP ${res.status}  ${res.headers.get("content-type")}`);
if (!res.ok || !res.body) {
  console.log(await res.text());
  process.exit(2);
}

const show = (s) => (s.length > 140 ? `${s.slice(0, 140)}...` : s);
function handle(block) {
  if (block.startsWith(":")) return console.log(`${ms()}  (comment) ${block}`);
  let event = "message";
  let data = "";
  for (const l of block.split("\n")) {
    if (l.startsWith("event: ")) event = l.slice(7);
    else if (l.startsWith("data: ")) data += l.slice(6);
  }
  if (event === "token") {
    tokens++;
    firstToken ??= Date.now() - t0;
    text += JSON.parse(data).t;
  }
  console.log(`${ms()}  ${event.padEnd(7)} ${show(data)}`);
}

const reader = res.body.getReader();
const decoder = new TextDecoder();
let buf = "";
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
  let i;
  while ((i = buf.indexOf("\n\n")) !== -1) {
    const block = buf.slice(0, i);
    buf = buf.slice(i + 2);
    if (block.trim()) handle(block);
  }
}
console.log(
  `\nTokens: ${tokens}  Time to first token: ${firstToken ?? "n/a"} ms  Total: ${Date.now() - t0} ms`,
);
console.log(`Streamed text:\n${text}`);
