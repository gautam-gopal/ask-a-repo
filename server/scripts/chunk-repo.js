import { loadRepo, GithubError } from "../src/services/github.js";
import { chunkRepo, splitLines, DEFAULTS } from "../src/services/chunker.js";

const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith("http"));
const num = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : Number(args[i + 1]);
};
if (!url) {
  console.error(
    "Usage: node server/scripts/chunk-repo.js <github-repo-url> [--window N] [--overlap M]",
  );
  process.exit(1);
}
const options = {};
if (num("--window") !== undefined) options.windowLines = num("--window");
if (num("--overlap") !== undefined) options.overlapLines = num("--overlap");
const maxChunkChars = DEFAULTS.maxChunkChars;

function selfCheck(files, chunks) {
  const linesByPath = new Map(files.map((f) => [f.path, splitLines(f.text)]));
  const covered = new Map(files.map((f) => [f.path, new Set()]));
  for (const c of chunks) {
    const lines = linesByPath.get(c.path);
    const tag = `${c.path}:${c.startLine}-${c.endLine}`;
    if (
      !lines ||
      c.startLine < 1 ||
      c.endLine > lines.length ||
      c.startLine > c.endLine
    )
      return `bad range ${tag}`;
    const claimed = lines.slice(c.startLine - 1, c.endLine).join("\n");
    const isSegment =
      c.startLine === c.endLine &&
      lines[c.startLine - 1].length > maxChunkChars;
    if (
      isSegment ? !lines[c.startLine - 1].includes(c.text) : c.text !== claimed
    )
      return `text does not match its line range ${tag}`;
    if (c.embedText !== `File: ${c.path}\n${c.text}`)
      return `bad embedText ${tag}`;
    for (let l = c.startLine; l <= c.endLine; l++) covered.get(c.path).add(l);
  }
  for (const [p, lines] of linesByPath)
    for (let i = 0; i < lines.length; i++)
      if (lines[i].trim() !== "" && !covered.get(p).has(i + 1))
        return `uncovered line ${p}:${i + 1}`;
  return null;
}

try {
  const repo = await loadRepo(url);
  const { chunks, stats } = chunkRepo(repo.files, options);
  console.log(`Repo:   ${repo.owner}/${repo.repo} @ ${repo.sha.slice(0, 7)}`);
  console.log(`Options: ${JSON.stringify({ ...DEFAULTS, ...options })}`);
  console.log(
    `Files: ${stats.files}  Chunks: ${stats.chunks}  Avg chars: ${stats.avgChars}  Max chars: ${stats.maxChars}`,
  );
  for (const c of chunks.slice(0, 2)) {
    console.log(
      `\n--- ${c.path} lines ${c.startLine}-${c.endLine} (${c.text.length} chars)`,
    );
    console.log(c.text.split("\n").slice(0, 6).join("\n"));
  }
  const failure = selfCheck(repo.files, chunks);
  console.log(failure ? `\nFAIL: ${failure}` : "\nPASS");
  process.exit(failure ? 1 : 0);
} catch (err) {
  if (err instanceof GithubError) {
    console.error(`${err.code}: ${err.message}`);
    process.exit(2);
  }
  console.error("Error:", err?.message ?? err);
  process.exit(1);
}
