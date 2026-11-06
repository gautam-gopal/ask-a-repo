// node server/eval/threshold-sweep.js <run-label>
// Reads server/eval/runs/<label>.json. Does NOT touch any config.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sweepThresholds, thresholdMarkers, pct } from "./lib.js";

const label = process.argv[2];
if (!label || !/^[A-Za-z0-9._-]{1,60}$/.test(label)) {
  console.error("Usage: node server/eval/threshold-sweep.js <run-label>");
  process.exit(1);
}
const file = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "runs",
  `${label}.json`,
);
if (!fs.existsSync(file)) {
  console.error(
    `No ${file}. Run server/scripts/eval.js --yes --label ${label} first (runs made before 10B have no .json).`,
  );
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(file, "utf8"));
if (!Array.isArray(data.results) || data.results.length === 0) {
  console.error("The run file has no results.");
  process.exit(1);
}

const rows = sweepThresholds(data.results);
const { zero, atMostOne } = thresholdMarkers(rows);
const { onN, offN, ovN } = rows[0];
const frac = (a, n) => (n ? `${a}/${n} ${pct(a / n)}` : "-");

console.log(
  `Run: ${data.label}  (on-topic ${onN}, off-topic ${offN}, overview ${ovN})`,
);
console.log(
  "A question passes when its top score >= threshold; below it the app answers notFound and skips the LLM.\n",
);
const table = [
  [
    "threshold",
    "on-topic pass",
    "on-topic rejected",
    "off-topic rejected",
    "overview pass",
    "",
  ],
  ...rows.map((r) => [
    r.t.toFixed(3),
    frac(r.onPass, r.onN),
    frac(r.onN - r.onPass, r.onN),
    frac(r.offRejected, r.offN),
    frac(r.ovPass, r.ovN),
    [
      r.t === zero ? "<- highest with 0 on-topic rejections" : "",
      r.t === atMostOne ? "<- highest with <=1 on-topic rejection" : "",
    ]
      .filter(Boolean)
      .join(" "),
  ]),
];
const widths = table[0].map((_, c) =>
  Math.max(...table.map((r) => String(r[c]).length)),
);
for (const r of table)
  console.log(r.map((v, c) => String(v).padEnd(widths[c])).join("  "));

console.log(
  `\nHighest threshold with 0 on-topic rejections: ${zero ?? "none in 0.70-0.90"}`,
);
console.log(
  `Highest threshold with at most 1 on-topic rejection: ${atMostOne ?? "none in 0.70-0.90"}`,
);
console.log(
  `\nSMALL SAMPLE: ${onN} on-topic and ${offN} off-topic questions over 2 repos${ovN ? `, ${ovN} overview` : ""}. One question moves a rate by ${onN ? (100 / onN).toFixed(1) : "?"} points (on-topic) or ${offN ? (100 / offN).toFixed(1) : "?"} points (off-topic). Treat the numbers as indicative, not proof. The scores are compressed (D-023), so the on-topic and off-topic ranges overlap and no threshold separates them perfectly. Nothing was written to config.`,
);
