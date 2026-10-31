import {
  parseRepoUrl,
  resolveRepo,
  fetchTree,
  filterTree,
  fetchFileContents,
  getRateLimit,
  GithubError,
} from "../src/services/github.js";

const args = process.argv.slice(2);
const fetchContents = args.includes("--fetch");
const url = args.find((a) => !a.startsWith("--"));
if (!url) {
  console.error(
    "Usage: node server/scripts/list-repo.js <github-repo-url> [--fetch]",
  );
  process.exit(1);
}

try {
  const parsed = parseRepoUrl(url);
  const { owner, repo, branch, sha } = await resolveRepo(parsed);
  const entries = await fetchTree(owner, repo, sha);
  const { files, totalBytes, skipped } = filterTree(entries);

  console.log(`Repo:    ${owner}/${repo}`);
  console.log(`Branch:  ${branch}`);
  console.log(`SHA:     ${sha}`);
  console.log(`Kept:    ${files.length} files, ${totalBytes} bytes`);
  console.log("Largest kept files:");
  [...files]
    .sort((a, b) => b.size - a.size)
    .slice(0, 10)
    .forEach((f) => console.log(`  ${String(f.size).padStart(8)}  ${f.path}`));
  console.log("Skipped:");
  for (const [reason, n] of Object.entries(skipped))
    console.log(`  ${reason}: ${n}`);

  if (fetchContents) {
    const before = getRateLimit().remaining; // after the tree call, before downloads
    const t0 = Date.now();
    const content = await fetchFileContents(owner, repo, sha, files);
    const secs = ((Date.now() - t0) / 1000).toFixed(2);
    const countLines = (t) =>
      t === "" ? 0 : t.split("\n").length - (t.endsWith("\n") ? 1 : 0);
    const lines = content.files.reduce((n, f) => n + countLines(f.text), 0);
    const rl = getRateLimit();
    console.log(`Fetched: ${content.files.length} files in ${secs}s`);
    console.log(`Total lines: ${lines}`);
    console.log(
      `Content skipped: size_mismatch ${content.skipped.size_mismatch}, not_utf8 ${content.skipped.not_utf8}`,
    );
    for (const s of content.skippedFiles)
      console.log(`  ${s.reason}: ${s.path}`);
    if (before !== null && rl.remaining !== null)
      console.log(
        `Requests used by downloads: ${before - rl.remaining} (remaining ${rl.remaining} of ${rl.limit})`,
      );
  }
} catch (err) {
  if (err instanceof GithubError) {
    console.error(`${err.code}: ${err.message}`);
    process.exit(2);
  }
  console.error("Unexpected error:", err?.message ?? err);
  process.exit(1);
}
