import { parseRepoUrl } from "./github.js";

// urls: exactly two GitHub URLs. existing: the demo user's repos
// [{ ownerLower, nameLower, status, isDemo }].
// action: skip (ready demo repo) | ingest (missing or failed) | replace (anything else, delete first)
export function planRepos(urls, existing) {
  if (!Array.isArray(urls) || urls.length !== 2)
    throw new RangeError("Give exactly two repository URLs.");
  const seen = new Set();
  return urls.map((url) => {
    const { owner, repo } = parseRepoUrl(url); // throws GithubError INVALID_URL
    const key = `${owner.toLowerCase()}/${repo.toLowerCase()}`;
    if (seen.has(key))
      throw new RangeError("The two URLs must be different repositories.");
    seen.add(key);
    const found = existing.find(
      (r) => `${r.ownerLower}/${r.nameLower}` === key,
    );
    let action = "ingest";
    if (found && found.status === "ready" && found.isDemo) action = "skip";
    else if (found && found.status !== "failed") action = "replace";
    return { url, key, action };
  });
}
