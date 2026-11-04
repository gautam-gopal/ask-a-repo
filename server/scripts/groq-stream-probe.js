// Live probe of Groq streaming. Spends Groq quota, so it needs --yes.
//   node server/scripts/groq-stream-probe.js --yes                  raw chunk shapes
//   node server/scripts/groq-stream-probe.js --yes --generate       full generateStream path
//   GROQ_MODEL=bogus/model node server/scripts/groq-stream-probe.js --yes --generate   fallback check
//   node server/scripts/groq-stream-probe.js --yes --generate --abort-after 3          abort check
import { config } from "../src/config.js";
import {
  ENDPOINT,
  buildStreamBody,
  generateStream,
  LlmError,
} from "../src/services/llm.js";

const args = process.argv.slice(2);
if (!args.includes("--yes")) {
  console.log("This spends 1 Groq request (2 on fallback). Re-run with --yes.");
  process.exit(0);
}
const MESSAGES = [
  { role: "system", content: "Answer briefly. Cite nothing." },
  { role: "user", content: "In two sentences, what is a JWT?" },
];
const t0 = Date.now();
const ms = () => `+${String(Date.now() - t0).padStart(5)}ms`;

if (args.includes("--generate")) {
  const i = args.indexOf("--abort-after");
  const abortAfter = i === -1 ? null : Number(args[i + 1]);
  const ctrl = new AbortController();
  let n = 0;
  try {
    const r = await generateStream({
      messages: MESSAGES,
      signal: ctrl.signal,
      onToken: (t) => {
        n++;
        if (n === 1) console.log(`${ms()}  first token`);
        if (abortAfter && n === abortAfter) {
          console.log(`${ms()}  aborting after ${n} tokens`);
          ctrl.abort();
        }
      },
    });
    console.log(`${ms()}  model ${r.model}  usedFallback ${r.usedFallback}`);
    console.log(`usage ${JSON.stringify(r.usage)}\ntext: ${r.text}`);
  } catch (err) {
    if (err instanceof LlmError)
      console.log(`${ms()}  LlmError ${err.code}: ${err.message}`);
    else console.log("Unexpected:", err?.message ?? err);
  }
  process.exit(0);
}

const res = await fetch(ENDPOINT, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${config.GROQ_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(buildStreamBody(config.GROQ_MODEL, MESSAGES)),
});
console.log(`${ms()}  HTTP ${res.status}  ${res.headers.get("content-type")}`);
if (!res.ok) {
  const j = await res.json().catch(() => null);
  console.log(`error code: ${j?.error?.code}  type: ${j?.error?.type}`); // never the full body
  process.exit(2);
}

const summary = {
  content: 0,
  reasoning: 0,
  other: 0,
  finish: [],
  usageAt: [],
  done: false,
  contentChars: 0,
};
const deltaKeys = new Set();
const shown = [];
const handle = (data) => {
  if (data === "[DONE]") {
    summary.done = true;
    return console.log(`${ms()}  [DONE]`);
  }
  const j = JSON.parse(data);
  const c = j.choices?.[0];
  for (const k of Object.keys(c?.delta ?? {})) deltaKeys.add(k);
  if (typeof c?.delta?.content === "string" && c.delta.content) {
    summary.content++;
    summary.contentChars += c.delta.content.length;
  } else if (c?.delta?.reasoning || c?.delta?.reasoning_content)
    summary.reasoning++;
  else summary.other++;
  if (c?.finish_reason) summary.finish.push(c.finish_reason);
  if (j.usage) summary.usageAt.push("usage");
  if (j.x_groq?.usage) summary.usageAt.push("x_groq.usage");
  if (
    shown.length < 4 ||
    c?.finish_reason ||
    j.usage ||
    j.x_groq?.usage ||
    (j.choices ?? []).length === 0
  )
    shown.push(
      `${ms()}  keys=${Object.keys(j)} choices=${j.choices?.length} delta=${JSON.stringify(c?.delta)?.slice(0, 80)} finish=${c?.finish_reason ?? "-"}`,
    );
};

const dec = new TextDecoder();
let buf = "";
for await (const chunk of res.body) {
  buf += dec.decode(chunk, { stream: true });
  let i;
  while ((i = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, i).replace(/\r$/, "");
    buf = buf.slice(i + 1);
    if (line.startsWith("data:")) handle(line.slice(5).trim());
  }
}
if (buf.trim())
  console.log("LEFTOVER (no trailing newline):", buf.slice(0, 80));
console.log(shown.join("\n"));
console.log(`\ndelta keys seen: ${[...deltaKeys]}`);
console.log(JSON.stringify(summary, null, 2));
