// SECURITY: answers, questions and server text are rendered as plain text only (D-053, D-057).
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { askQuestion, getRepo, listMessages } from "../api.js";
import { ErrorMessage, Spinner, useTitle } from "../components.jsx";
import {
  formatAskError,
  isGithubUrl,
  linkifyCitations,
  orderSources,
} from "../chatHelpers.js";

const MAX_QUESTION = 500;

function Answer({ msg, onChip }) {
  if (msg.notFound)
    return (
      <p className="answer">
        I couldn't find this in the repository.{" "}
        <span className="muted">
          Try rephrasing, or mention a file, function or feature by name.
        </span>
      </p>
    );
  const segments = linkifyCitations(msg.answer, msg.sources);
  return (
    <p className="answer">
      {segments.map((s, i) =>
        s.type === "text" ? (
          <span key={i}>{s.text}</span>
        ) : (
          <button
            key={i}
            type="button"
            className="chip"
            aria-label={`Show source ${s.n}`}
            onClick={() => onChip(msg.id, s.n)}
          >
            [{s.n}]
          </button>
        ),
      )}
    </p>
  );
}

function Sources({ msgId, sources, flash }) {
  const list = orderSources(sources);
  if (list.length === 0) return null;
  return (
    <div className="sources">
      <p className="muted small">Sources</p>
      <ul className="source-list">
        {list.map((s) => {
          const label = `${s.path}:${s.startLine}-${s.endLine}`;
          const key = `${msgId}-${s.n}`;
          return (
            <li
              key={s.n}
              id={`src-${key}`}
              className={`source${s.cited ? " cited" : ""}${flash === key ? " flash" : ""}`}
            >
              <span className="source-n">[{s.n}]</span>{" "}
              {isGithubUrl(s.url) ? (
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  {label}
                </a>
              ) : (
                <span>{label}</span>
              )}{" "}
              {s.cited && <span className="badge badge-ready">cited</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Turn({ msg, flash, onChip }) {
  return (
    <li className="turn">
      <p className="q">{msg.question}</p>
      <Answer msg={msg} onChip={onChip} />
      {!msg.notFound && (
        <Sources msgId={msg.id} sources={msg.sources} flash={flash} />
      )}
      {msg.usedFallback && (
        <p className="muted small">
          Answered by the smaller fallback model because the main one was busy.
        </p>
      )}
    </li>
  );
}

export default function ChatPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [repo, setRepo] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(null); // the question being answered
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(null);
  const [announce, setAnnounce] = useState("");

  const alive = useRef(false);
  const sending = useRef(false);
  const inputRef = useRef(null);
  const endRef = useRef(null);
  const flashTimer = useRef(null);

  useTitle(
    repo ? `${repo.owner}/${repo.name} · Ask-a-Repo` : "Chat · Ask-a-Repo",
  );

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(flashTimer.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    (async () => {
      try {
        const [{ repo: r }, { messages: list }] = await Promise.all([
          getRepo(id),
          listMessages(id),
        ]);
        if (cancelled) return;
        if (r.status !== "ready")
          return navigate("/repos", {
            replace: true,
            state: {
              notice:
                "That repository is not ready yet. Open it once it shows Ready.",
            },
          });
        setRepo(r);
        setMessages(list);
      } catch (err) {
        if (cancelled) return;
        if (err.code === "REPO_NOT_FOUND" || err.code === "INVALID_ID")
          return navigate("/repos", {
            replace: true,
            state: {
              notice:
                "Repository not found. It may have been deleted or expired.",
            },
          });
        setLoadError(err.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, navigate, reloadKey]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [repo, messages.length, pending]);

  const onChip = useCallback((msgId, n) => {
    const key = `${msgId}-${n}`;
    document
      .getElementById(`src-${key}`)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    setFlash(key);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 2000);
  }, []);

  async function send() {
    if (sending.current) return;
    const question = text.trim();
    if (!question) return setError("Enter a question.");
    sending.current = true;
    setError(null);
    setPending(question);
    try {
      const r = await askQuestion(id, question);
      if (!alive.current) return;
      setMessages((prev) => [
        ...prev,
        {
          id: r.id,
          question,
          answer: r.answer,
          notFound: r.notFound,
          sources: r.sources ?? [],
          model: r.model,
          usedFallback: r.usedFallback,
        },
      ]);
      setText("");
      setAnnounce(
        r.notFound ? "No answer found in the repository." : (r.answer ?? ""),
      );
    } catch (err) {
      if (!alive.current) return;
      setError(formatAskError(err)); // the typed question stays in the box
    } finally {
      sending.current = false;
      if (alive.current) {
        setPending(null);
        inputRef.current?.focus();
      }
    }
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  }

  const back = (
    <Link className="back" to="/repos">
      ← Back to repositories
    </Link>
  );

  if (loadError)
    return (
      <>
        {back}
        <ErrorMessage message={loadError} />
        <button type="button" onClick={() => setReloadKey((k) => k + 1)}>
          Retry
        </button>
      </>
    );
  if (!repo)
    return (
      <>
        {back}
        <div className="center">
          <Spinner />
        </div>
      </>
    );

  return (
    <>
      {back}
      <h1 className="repo-name">
        {repo.owner}/{repo.name}
      </h1>
      <p className="muted small">
        Answers cite code at commit {repo.commitSha?.slice(0, 7)}.
      </p>

      <div className="sr-only" role="status" aria-live="polite">
        {announce}
      </div>

      {messages.length === 0 && !pending && (
        <p className="muted">
          Ask a question about this repository, for example "Where is
          authentication handled?"
        </p>
      )}
      <ul className="chat-list">
        {messages.map((m) => (
          <Turn key={m.id} msg={m} flash={flash} onChip={onChip} />
        ))}
        {pending && (
          <li className="turn">
            <p className="q">{pending}</p>
            <p className="muted">
              <Spinner /> Searching the code and writing an answer...
            </p>
          </li>
        )}
      </ul>
      <div ref={endRef} className="chat-end" />

      <div className="chat-form">
        <ErrorMessage message={error} />
        <label htmlFor="question" className="sr-only">
          Your question
        </label>
        <textarea
          id="question"
          ref={inputRef}
          rows={2}
          value={text}
          maxLength={MAX_QUESTION}
          readOnly={pending !== null}
          placeholder="Ask about this repository (Enter to send, Shift+Enter for a new line)"
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          onKeyDown={onKeyDown}
        />
        <div className="chat-meta">
          <span className="muted small">
            {text.length}/{MAX_QUESTION}
          </span>
          <button type="button" onClick={send} disabled={pending !== null}>
            {pending !== null ? "Sending..." : "Send"}
          </button>
        </div>
      </div>
    </>
  );
}
