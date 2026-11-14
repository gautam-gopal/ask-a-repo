// SECURITY: answers, questions and server text are rendered as plain text only (D-053, D-057).
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { askStream, getRepo, listMessages } from "../api.js";
import { ErrorMessage, Spinner, useTitle } from "../components.jsx";
import AnswerMarkdown from "../components/AnswerMarkdown.jsx";
import { formatAskError, isGithubUrl, orderSources } from "../chatHelpers.js";

const MAX_QUESTION = 500;
const PIN_THRESHOLD_PX = 80;

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
  return (
    <AnswerMarkdown
      text={msg.answer ?? ""}
      sources={msg.sources}
      onCitationClick={(n) => onChip(msg.id, n)}
    />
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

// The answer being streamed (or a stopped / interrupted one). Not saved server-side.
function LiveTurn({ live, flash, onChip }) {
  const streaming = live.status === "streaming";
  return (
    <li className="turn" aria-busy={streaming}>
      <p className="q">{live.question}</p>
      {live.text !== "" ? (
        <Answer
          msg={{
            id: "live",
            answer: live.text,
            sources: live.sources,
            notFound: false,
          }}
          onChip={onChip}
        />
      ) : (
        streaming && (
          <p className="muted">
            <Spinner /> Searching the code and writing an answer...
          </p>
        )
      )}
      <Sources msgId="live" sources={live.sources} flash={flash} />
      {live.status === "stopped" && (
        <p className="muted small">
          Stopped. This partial answer was not saved.
        </p>
      )}
      {live.status === "error" && (
        <p className="muted small">
          This answer was cut off and was not saved. Your question is still in
          the box.
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
  // { question, text, sources, status: "streaming" | "stopped" | "error" } or null
  const [live, setLive] = useState(null);
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(null);
  const [announce, setAnnounce] = useState("");

  const alive = useRef(false);
  const sending = useRef(false);
  const abortRef = useRef(null); // AbortController of the stream in flight
  const textRef = useRef(""); // tokens accumulate here; state is updated once per frame
  const raf = useRef(0);
  const pinned = useRef(true); // true while the user is at the bottom
  const inputRef = useRef(null);
  const endRef = useRef(null);
  const flashTimer = useRef(null);

  const streaming = live?.status === "streaming";

  useTitle(
    repo ? `${repo.owner}/${repo.name} · Ask-a-Repo` : "Chat · Ask-a-Repo",
  );

  const cancelFrame = useCallback(() => {
    if (raf.current) {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    }
  }, []);
  const syncText = (l) =>
    l && l.text !== textRef.current ? { ...l, text: textRef.current } : l;
  const flushNow = useCallback(() => {
    cancelFrame();
    setLive(syncText);
  }, [cancelFrame]);
  const schedule = useCallback(() => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      setLive(syncText);
    });
  }, []);
  // Silent cancel: no state updates from the aborted send (its active() check fails).
  const cancelStream = useCallback(() => {
    const c = abortRef.current;
    abortRef.current = null;
    sending.current = false;
    c?.abort();
    cancelFrame();
  }, [cancelFrame]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      cancelStream();
      clearTimeout(flashTimer.current);
    };
  }, [cancelStream]);

  useEffect(() => {
    const onScroll = () => {
      pinned.current =
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - PIN_THRESHOLD_PX;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    let cancelled = false;
    cancelStream(); // switching repos or retrying: drop any stream from the previous view
    setLive(null);
    setError(null);
    setText("");
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
  }, [id, navigate, reloadKey, cancelStream]);

  // Keep the bottom in view only while the user has not scrolled up.
  useEffect(() => {
    if (pinned.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [repo, messages.length, live]);

  const onChip = useCallback((msgId, n) => {
    const key = `${msgId}-${n}`;
    const el = document.getElementById(`src-${key}`);
    if (!el) return;
    pinned.current = false; // stop the stream auto-scroll fighting this scroll
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    el.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      block: "center",
    });
    clearTimeout(flashTimer.current);
    setFlash(null); // clear first so clicking the same chip again re-flashes
    requestAnimationFrame(() => setFlash(key));
    flashTimer.current = setTimeout(() => setFlash(null), 2000);
  }, []);

  // Error or drop: keep the partial text if there is any, otherwise remove the live turn.
  function failLive() {
    flushNow();
    setLive((l) =>
      l && l.text === "" && l.sources.length === 0
        ? null
        : l && { ...l, status: "error" },
    );
  }

  async function send() {
    if (sending.current) return;
    const question = text.trim();
    if (!question) return setError("Enter a question.");
    sending.current = true;
    pinned.current = true;
    textRef.current = "";
    cancelFrame();
    setError(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const active = () => alive.current && abortRef.current === ctrl;
    setLive({ question, text: "", sources: [], status: "streaming" });
    setAnnounce("Searching the code and writing an answer.");
    try {
      await askStream({
        repoId: id,
        question,
        signal: ctrl.signal,
        onSources: (sources) => {
          if (active()) setLive((l) => l && { ...l, sources });
        },
        onToken: (t) => {
          if (!active()) return;
          textRef.current += t;
          schedule();
        },
        onDone: (d) => {
          if (!active()) return;
          cancelFrame();
          setMessages((prev) => [
            ...prev,
            {
              id: d.id,
              question,
              answer: d.answer,
              notFound: d.notFound,
              sources: d.sources ?? [],
              model: d.model,
              usedFallback: d.usedFallback,
            },
          ]);
          setLive(null);
          setText("");
          setAnnounce(
            d.notFound
              ? "No answer found in the repository."
              : "Answer complete.",
          );
        },
        onError: (e) => {
          if (!active()) return;
          failLive();
          setError(formatAskError(e));
        },
      });
    } catch (err) {
      if (!active()) return; // unmounted or navigated away: stay silent
      if (err.code === "ABORTED") {
        flushNow();
        setLive((l) => l && { ...l, status: "stopped" });
        setAnnounce("Stopped.");
      } else {
        failLive();
        setError(formatAskError(err));
      }
    } finally {
      if (active()) {
        abortRef.current = null;
        sending.current = false;
        inputRef.current?.focus();
      }
    }
  }

  function stop() {
    abortRef.current?.abort(); // send()'s catch marks the turn stopped
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

      {/* Announces start and completion only, never individual tokens. */}
      <div className="sr-only" role="status" aria-live="polite">
        {announce}
      </div>

      {messages.length === 0 && !live && (
        <p className="muted">
          Ask a question about this repository, for example "Where is
          authentication handled?"
        </p>
      )}
      <ul className="chat-list">
        {messages.map((m) => (
          <Turn key={m.id} msg={m} flash={flash} onChip={onChip} />
        ))}
        {live && <LiveTurn live={live} flash={flash} onChip={onChip} />}
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
          readOnly={streaming}
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
          {streaming ? (
            <button type="button" className="secondary" onClick={stop}>
              Stop
            </button>
          ) : (
            <button type="button" onClick={send}>
              Send
            </button>
          )}
        </div>
      </div>
    </>
  );
}
