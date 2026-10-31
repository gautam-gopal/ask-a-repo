import {
  parseRepoUrl,
  resolveRepo,
  fetchTree,
  filterTree,
  GithubError,
} from "../src/services/github.js";

const url = process.argv[2];
if (!url) {
  console.error("Usage: node server/scripts/list-repo.js <github-repo-url>");
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
} catch (err) {
  if (err instanceof GithubError) {
    console.error(`${err.code}: ${err.message}`);
    process.exit(2);
  }
  console.error("Unexpected error:", err?.message ?? err);
  process.exit(1);
}
