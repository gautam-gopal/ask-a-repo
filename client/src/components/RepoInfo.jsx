import { Link } from "react-router-dom";
import { githubCommitUrl, githubRepoUrl } from "../chatHelpers.js";
import { statusLabel } from "../repoHelpers.js";

const EXT = { target: "_blank", rel: "noopener noreferrer" };

export default function RepoInfo({ repo }) {
  const full = `${repo.owner}/${repo.name}`;
  const repoUrl = githubRepoUrl(repo);
  const commitUrl = githubCommitUrl(repo);
  const sha =
    typeof repo.commitSha === "string" ? repo.commitSha.slice(0, 7) : null;

  return (
    <section className="repo-info" aria-labelledby="repo-title">
      <Link className="back" to="/repos">
        ← Back to repositories
      </Link>
      <h1 id="repo-title" className="repo-info__title">
        {repoUrl ? (
          <a href={repoUrl} {...EXT}>
            {full}
            <span className="sr-only"> (opens GitHub in a new tab)</span>
          </a>
        ) : (
          full
        )}
      </h1>
      <dl className="repo-info__facts">
        <div>
          <dt>Status</dt>
          <dd>
            <span className={`badge badge-${repo.status}`}>
              {statusLabel(repo.status)}
            </span>
          </dd>
        </div>
        <div>
          <dt>Files</dt>
          <dd>{repo.fileCount}</dd>
        </div>
        <div>
          <dt>Chunks</dt>
          <dd>{repo.chunkCount}</dd>
        </div>
        <div>
          <dt>Commit</dt>
          <dd>
            {commitUrl && sha ? (
              <a className="mono" href={commitUrl} {...EXT}>
                {sha}
                <span className="sr-only"> (opens GitHub in a new tab)</span>
              </a>
            ) : (
              (sha ?? "unknown")
            )}
          </dd>
        </div>
      </dl>
      <p className="repo-info__note muted small">
        Answers cite code at this commit.
      </p>
    </section>
  );
}
