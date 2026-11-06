// node server/eval/compare.js : all runs in results.csv, sorted by hit@5 then MRR.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const file = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "results.csv",
);
if (!fs.existsSync(file)) {
  console.error(
    "No server/eval/results.csv yet. Run server/scripts/eval.js --yes first.",
  );
  process.exit(1);
}
const [head, ...lines] = fs
  .readFileSync(file, "utf8")
  .split(/\r?\n/)
  .filter(Boolean);
const cols = head.split(",");
const rows = lines.map((l) =>
  Object.fromEntries(l.split(",").map((v, i) => [cols[i], v])),
);
const num = (v) => (v === undefined || v === "" ? null : Number(v));
const pct = (v) => (num(v) === null ? "-" : `${(num(v) * 100).toFixed(1)}%`);
const f3 = (v) => (num(v) === null ? "-" : num(v).toFixed(3));

rows.sort((a, b) => num(b.hit5) - num(a.hit5) || num(b.mrr) - num(a.mrr));
const best = num(rows[0].hit5);
const base = [...rows].reverse().find((r) => r.label === "baseline");

const table = [
  [
    "",
    "label",
    "win",
    "ovl",
    "max",
    "pfx",
    "qpfx",
    "mrg",
    "chunks",
    ">512",
    "hit@1",
    "hit@3",
    "hit@5",
    "vs base",
    "MRR",
    "avg rk",
    "off med",
    "off max",
  ],
  ...rows.map((r) => [
    num(r.hit5) === best ? "*" : "",
    r.label,
    r.window,
    r.overlap,
    r.max_chars,
    r.prefix,
    r.query_prefix,
    r.merge,
    r.chunks,
    pct(r.over512_frac),
    pct(r.hit1),
    pct(r.hit3),
    pct(r.hit5),
    base ? `${((num(r.hit5) - num(base.hit5)) * 100).toFixed(1)}` : "-",
    f3(r.mrr),
    f3(r.avg_rank),
    f3(r.off_top_median),
    f3(r.off_top_max),
  ]),
];
const widths = table[0].map((_, c) =>
  Math.max(...table.map((r) => String(r[c]).length)),
);
for (const r of table)
  console.log(r.map((v, c) => String(v).padEnd(widths[c])).join("  "));

const tied = rows.filter((r) => num(r.hit5) === best).length;
const q = num(rows[0].questions);
console.log(
  `\n* = best hit@5${tied > 1 ? ` (${tied} runs tie; order within the tie is by MRR)` : ""}. "vs base" is in percentage points of hit@5.`,
);
if (q)
  console.log(
    `With ${q} questions one question is ${(100 / q).toFixed(1)} points of hit@5; differences of one or two questions are noise.`,
  );
