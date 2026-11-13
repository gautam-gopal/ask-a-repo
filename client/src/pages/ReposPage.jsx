import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { createRepo, deleteRepo, listRepos } from "../api.js";
import {
  Alert,
  EmptyState,
  ErrorMessage,
  PageHeader,
  Spinner,
  useTitle,
} from "../components.jsx";
import {
  formatCreated,
  formatError,
  isActive,
  progressPercent,
  statusLabel,
} from "../repoHelpers.js";
import { useAuth } from "../auth.jsx";

const POLL_MS = 3000;
const MAX_POLL_MS = 30_000;
const REPO_LIMIT = 3;

const sameRepo = (a, b) =>
  a.owner.toLowerCase() === b.owner.toLowerCase() &&
  a.name.toLowerCase() === b.name.toLowerCase();

function RepoRow({
  repo,
  readOnly,
  confirming,
  busy,
  error,
  onAskConfirm,
  onCancel,
  onDelete,
}) {
  const active = isActive(repo.status);
  const pct = progressPercent(repo.progress);
  const embedded = repo.progress?.embedded ?? 0;
  const total = repo.progress?.total ?? 0;
  const created = formatCreated(repo.createdAt);
  const full = `${repo.owner}/${repo.name}`;

  return (
    <li className="repo-card">
      <div className="repo-card__head">
        <h3 className="repo-card__name">
          <span className="repo-card__owner">{repo.owner}/</span>
          {repo.name}
        </h3>
        <span className={`badge badge-${repo.status}`}>
          {statusLabel(repo.status)}
        </span>
      </div>
      {created && <p className="repo-card__meta">Added {created}</p>}

      {active && (
        <div>
          <progress
            className="progress"
            max={100}
            value={repo.status === "indexing" && total > 0 ? pct : undefined}
            aria-label={`Indexing progress for ${full}`}
          />
          <p className="repo-card__meta">
            {repo.status === "queued"
              ? "Queued. Waiting to start."
              : total > 0
                ? `Indexing: embedded ${embedded} of ${total} chunks (${pct}%)`
                : "Indexing: fetching and chunking files..."}
          </p>
        </div>
      )}

      {repo.status === "ready" && (
        <p className="repo-card__stats">
          {repo.fileCount} files · {repo.chunkCount} chunks
        </p>
      )}

      {repo.status === "failed" && (
        <ErrorMessage message={repo.error?.message || "Indexing failed."} />
      )}
      <ErrorMessage message={error} />

      <div className="repo-card__actions">
        {confirming && !readOnly ? (
          <div
            className="confirm"
            role="group"
            aria-label={`Confirm delete ${full}`}
          >
            <p className="confirm__text">
              Delete this repository and its chat history?
            </p>
            <div className="confirm__buttons">
              <button
                type="button"
                className="btn btn-danger"
                onClick={onDelete}
                disabled={busy}
              >
                Yes, delete
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onCancel}
                disabled={busy}
                autoFocus
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            {repo.status === "ready" && (
              <Link
                className="btn"
                to={`/repos/${encodeURIComponent(repo.id)}`}
                aria-label={`Open ${full}`}
              >
                Open
              </Link>
            )}
            {!readOnly &&
              (repo.status === "failed" ? (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={onDelete}
                  disabled={busy}
                  aria-busy={busy}
                  aria-label={`Remove ${full}`}
                >
                  {busy ? "Removing..." : "Remove"}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={onAskConfirm}
                  disabled={busy}
                  aria-busy={busy}
                  aria-label={`Delete ${full}`}
                >
                  {busy ? "Deleting..." : "Delete"}
                </button>
              ))}
          </>
        )}
      </div>
    </li>
  );
}

export default function ReposPage() {
  const { demo } = useAuth();

  useTitle("Repositories · Ask-a-Repo");
  const notice = useLocation().state?.notice;

  const [repos, setRepos] = useState(null); // null = not loaded yet
  const [loadError, setLoadError] = useState(null);
  const [url, setUrl] = useState("");
  const [addError, setAddError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmId, setConfirmId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [rowError, setRowError] = useState(null); // { id, message }

  const alive = useRef(false);
  const inFlight = useRef(false);
  const failures = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // One list request at a time. Never throws. Ignores results after unmount.
  const load = useCallback(async ({ first = false } = {}) => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const { repos: list } = await listRepos({ wakeHint: first });
      if (!alive.current) return;
      failures.current = 0;
      setRepos(list);
      setLoadError(null);
    } catch (err) {
      if (!alive.current) return;
      failures.current++;
      setLoadError(err.message);
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    load({ first: true });
  }, [load]);

  const active = repos !== null && repos.some((r) => isActive(r.status));

  // Poll only while something is queued or indexing and the tab is visible.
  useEffect(() => {
    if (!active) return;
    let timer = null;
    let running = false;
    let stopped = false;
    const delay = () => Math.min(POLL_MS * 2 ** failures.current, MAX_POLL_MS);
    const tick = async () => {
      timer = null;
      running = true;
      await load();
      running = false;
      if (!stopped && !document.hidden) timer = setTimeout(tick, delay());
    };
    const onVisibility = () => {
      if (document.hidden) {
        clearTimeout(timer);
        timer = null;
      } else if (timer === null && !running) {
        tick();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    if (!document.hidden) timer = setTimeout(tick, POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, load]);

  async function onAdd(e) {
    e.preventDefault();
    const clean = url.trim();
    if (!clean) return setAddError("Enter a GitHub repository URL.");
    if (clean.length > 200)
      return setAddError("The URL is too long (200 characters at most).");
    setAddError(null);
    setSubmitting(true);
    try {
      const { repo } = await createRepo(clean);
      if (!alive.current) return;
      setUrl("");
      // A re-added failed repo gets a new id; drop the old row with the same name.
      setRepos((prev) => [
        repo,
        ...(prev ?? []).filter((r) => !sameRepo(r, repo)),
      ]);
    } catch (err) {
      if (!alive.current) return;
      setAddError(formatError(err));
    } finally {
      if (alive.current) setSubmitting(false);
    }
  }

  async function onDelete(repo) {
    setConfirmId(null);
    setRowError(null);
    setBusyId(repo.id);
    try {
      await deleteRepo(repo.id);
      if (!alive.current) return;
      setRepos((prev) => (prev ?? []).filter((r) => r.id !== repo.id));
    } catch (err) {
      if (!alive.current) return;
      if (err.code === "REPO_NOT_FOUND")
        setRepos((prev) => (prev ?? []).filter((r) => r.id !== repo.id));
      else setRowError({ id: repo.id, message: err.message }); // server text, e.g. the 409
    } finally {
      if (alive.current) setBusyId(null);
    }
  }

  const count = repos?.length ?? 0;

  return (
    <>
      <PageHeader
        title="Repositories"
        subtitle={
          repos === null
            ? null
            : demo
              ? `${count} pre-indexed ${count === 1 ? "repository" : "repositories"}`
              : `${count} of ${REPO_LIMIT} repositories used`
        }
      />
      {notice && (
        <Alert variant="warning" role="status">
          {notice}
        </Alert>
      )}
      {!demo && (
        <form onSubmit={onAdd} noValidate className="card add-form">
          <label className="field__label" htmlFor="repo-url">
            GitHub repository URL
          </label>
          <div className="add-form__row">
            <input
              id="repo-url"
              type="text"
              inputMode="url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setAddError(null);
              }}
              placeholder="https://github.com/owner/name"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={200}
              disabled={submitting}
              aria-invalid={addError ? "true" : undefined}
              aria-describedby={
                addError ? "repo-url-error repo-url-help" : "repo-url-help"
              }
            />
            <button
              type="submit"
              className="btn"
              disabled={submitting}
              aria-busy={submitting}
            >
              {submitting ? "Adding..." : "Add repository"}
            </button>
          </div>
          {addError && (
            <p id="repo-url-error" className="field__error" role="alert">
              {addError}
            </p>
          )}
          <p id="repo-url-help" className="field__hint">
            Public GitHub repositories only, {REPO_LIMIT} at most, one indexing
            at a time. Up to 150 js, jsx, ts, tsx, json and md files (2 MB);
            test files are skipped. Repositories are removed after 7 days.
          </p>
        </form>
      )}

      <section aria-labelledby="repos-heading">
        <h2 id="repos-heading" className="section-title">
          {demo ? "Demo repositories" : "Your repositories"}
        </h2>
        {loadError && (
          <>
            <ErrorMessage
              message={
                active ? `${loadError} Will retry automatically.` : loadError
              }
            />
            {repos === null && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => load({ first: true })}
              >
                Retry
              </button>
            )}
          </>
        )}
        {repos === null && !loadError && (
          <div className="state">
            <Spinner />
            <p>Loading repositories...</p>
          </div>
        )}
        {repos !== null && repos.length === 0 && (
          <EmptyState title="No repositories yet">
            {demo
              ? "The demo has no repositories right now."
              : "Paste a public GitHub repository URL above to index it, then ask questions about its code."}
          </EmptyState>
        )}
        {repos !== null && repos.length > 0 && (
          <ul className="repo-grid">
            {repos.map((repo) => (
              <RepoRow
                key={repo.id}
                repo={repo}
                readOnly={demo}
                confirming={confirmId === repo.id}
                busy={busyId === repo.id}
                error={rowError?.id === repo.id ? rowError.message : null}
                onAskConfirm={() => {
                  setRowError(null);
                  setConfirmId(repo.id);
                }}
                onCancel={() => setConfirmId(null)}
                onDelete={() => onDelete(repo)}
              />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
