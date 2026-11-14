// SECURITY: answers, questions and server text are rendered as plain text only (D-053, D-057).
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { askStream, getRepo, listMessages } from "../api.js";
import { ErrorMessage, Spinner, useTitle } from "../components.jsx";
import AnswerMarkdown from "../components/AnswerMarkdown.jsx";
import RepoInfo from "../components/RepoInfo.jsx";
import SourcesPanel from "../components/SourcesPanel.jsx";
import {
  EXAMPLE_QUESTIONS,
  formatAskError,
  formatTime,
} from "../chatHelpers.js";

const MAX_QUESTION = 500;
const COUNTER_FROM = 400;
const PIN_THRESHOLD_PX = 80;

function Answer({ msg, onChip, onHover }) {
  if (msg.notFound)
    return (
      <div className="notice">
        <p>I couldn't find this in the repository.</p>
        <p className="muted small">
          Try rephrasing, or mention a file, function or feature by name.
        </p>
      </div>
    );
  return (
    <AnswerMarkdown
      text={msg.answer ?? ""}
      sources={msg.sources}
      onCitationClick={(n) => onChip(msg.id, n)}
      onCitationHover={onHover}
    />
  );
}

function Question({ text, time }) {
  return (
    <div className="q-block">
      <div className="turn__meta">
        <span className="label">You asked</span>
        {time && (
          <time className="turn__time" dateTime={time.iso}>
            {time.text}
          </time>
        )}
      </div>
      <p className="q-text">{text}</p>
    </div>
  );
}

function Turn({ msg, isLatest, target, onChip }) {
  const [hoverN, setHoverN] = useState(null);
  const text = formatTime(msg.createdAt);
  const time = text
    ? { text, iso: new Date(msg.createdAt).toISOString() }
    : null;
  return (
    <li className="turn">
      <Question text={msg.question} time={time} />
      <div className="a-block">
        <div className="turn__meta">
          <span className="label">Answer</span>
          {msg.model && <span className="muted small">{msg.model}</span>}
        </div>
        <Answer msg={msg} onChip={onChip} onHover={setHoverN} />
        {!msg.notFound && (
          <SourcesPanel
            msgId={msg.id}
            sources={msg.sources}
            isLatest={isLatest}
            target={target}
            hoverN={hoverN}
          />
        )}
        {msg.usedFallback && (
          <p className="muted small">
            Answered by the smaller fallback model because the main one was
            busy.
          </p>
        )}
      </div>
    </li>
  );
}

// The answer being streamed (or a stopped / interrupted one). Not saved server-side.
function LiveTurn({ live, target, onChip }) {
  const [hoverN, setHoverN] = useState(null);
  const streaming = live.status === "streaming";
  return (
    <li className="turn" aria-busy={streaming}>
      <Question text={live.question} />
      <div className="a-block">
        <div className="turn__meta">
          <span className="label">Answer</span>
          {streaming && <span className="muted small">writing...</span>}
          {live.status === "stopped" && (
            <span className="badge badge-queued">Stopped</span>
          )}
          {live.status === "error" && (
            <span className="badge badge-failed">Interrupted</span>
          )}
        </div>
        {live.text !== "" ? (
          <Answer
            msg={{
              id: "live",
              answer: live.text,
              sources: live.sources,
              notFound: false,
            }}
            onChip={onChip}
            onHover={setHoverN}
          />
        ) : (
          streaming && (
            <p className="muted">
              <Spinner /> Searching the code and writing an answer...
            </p>
          )
        )}
        <SourcesPanel
          msgId="live"
          sources={live.sources}
          isLatest
          target={target}
          hoverN={hoverN}
        />
        {live.status === "stopped" && (
          <p className="status-note">
            Stopped. This partial answer was not saved.
          </p>
        )}
        {live.status === "error" && (
          <p className="status-note">
            This answer was cut off and was not saved. Your question is still in
            the box.
          </p>
        )}
      </div>
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
  const [target, setTarget] = useState(null); // { msgId, n } from a chip click
  const [away, setAway] = useState(false); // scrolled up from the bottom
  const [announce, setAnnounce] = useState("");

  const alive = useRef(false);
  const sending = useRef(false);
  const abortRef = useRef(null);
  const textRef = useRef("");
  const raf = useRef(0);
  const pinned = useRef(true);
  const inputRef = useRef(null);
  const endRef = useRef(null);

  const streaming = live?.status === "streaming";
  const showJump = away && streaming;

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
    };
  }, [cancelStream]);

  useEffect(() => {
    const onScroll = () => {
      const atBottom =
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - PIN_THRESHOLD_PX;
      pinned.current = atBottom;
      setAway(!atBottom);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    let cancelled = false;
    cancelStream();
    setLive(null);
    setError(null);
    setText("");
    setTarget(null);
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

  // The sentinel sits after the composer, so the last message is never behind it.
  useEffect(() => {
    if (pinned.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [repo, messages.length, live]);

  // Auto-grow: CSSOM writes are not blocked by the CSP (D-120). CSS caps the height.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [text, repo]);

  const onChip = useCallback((msgId, n) => {
    pinned.current = false; // stop stream auto-scroll fighting the chip scroll
    setTarget({ msgId, n });
  }, []);

  function jump() {
    pinned.current = true;
    setAway(false);
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    endRef.current?.scrollIntoView({
      block: "end",
      behavior: reduce ? "auto" : "smooth",
    });
  }

  function pickExample(q) {
    setText(q);
    setError(null);
    inputRef.current?.focus();
  }

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
    setAway(false);
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
              createdAt: new Date().toISOString(),
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
      if (!active()) return;
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
    abortRef.current?.abort();
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  }

  if (loadError)
    return (
      <>
        <Link className="back" to="/repos">
          ← Back to repositories
        </Link>
        <ErrorMessage message={loadError} />
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setReloadKey((k) => k + 1)}
        >
          Retry
        </button>
      </>
    );
  if (!repo)
    return (
      <>
        <Link className="back" to="/repos">
          ← Back to repositories
        </Link>
        <div className="state">
          <Spinner />
          <p>Loading conversation...</p>
        </div>
      </>
    );

  const hasTurns = messages.length > 0 || live;

  return (
    <div className="chat-layout">
      <RepoInfo repo={repo} />
      <div className="chat-main">
        {/* Announces start and completion only, never individual tokens. */}
        <div className="sr-only" role="status" aria-live="polite">
          {announce}
        </div>

        {!hasTurns && (
          <section className="chat-empty" aria-labelledby="empty-title">
            <h2 id="empty-title">Ask a question about this repository</h2>
            <p className="muted">
              Answers cite the exact files and lines they came from. Try one of
              these:
            </p>
            <ul className="examples">
              {EXAMPLE_QUESTIONS.map((q) => (
                <li key={q}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => pickExample(q)}
                  >
                    {q}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {hasTurns && <h2 className="sr-only">Conversation</h2>}
        <ul className="chat-list">
          {messages.map((m, i) => (
            <Turn
              key={m.id}
              msg={m}
              isLatest={!live && i === messages.length - 1}
              target={target}
              onChip={onChip}
            />
          ))}
          {live && <LiveTurn live={live} target={target} onChip={onChip} />}
        </ul>

        <div className="composer">
          {showJump && (
            <button
              type="button"
              className="btn btn-secondary btn-sm jump"
              onClick={jump}
            >
              ↓ Jump to latest
            </button>
          )}
          <ErrorMessage message={error} />
          <label htmlFor="question" className="sr-only">
            Your question
          </label>
          <div className="composer__row">
            <textarea
              id="question"
              ref={inputRef}
              rows={1}
              value={text}
              maxLength={MAX_QUESTION}
              readOnly={streaming}
              placeholder="Ask about this repository"
              aria-describedby="composer-hint"
              aria-invalid={error ? "true" : undefined}
              onChange={(e) => {
                setText(e.target.value);
                setError(null);
              }}
              onKeyDown={onKeyDown}
            />
            <div className="composer__actions">
              {streaming && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={stop}
                >
                  Stop
                </button>
              )}
              <button
                type="button"
                className="btn"
                onClick={send}
                disabled={streaming || text.trim() === ""}
                aria-busy={streaming}
              >
                {streaming ? "Answering" : "Send"}
              </button>
            </div>
          </div>
          <p id="composer-hint" className="composer__hint">
            <span className="composer__keys">
              Enter to send, Shift+Enter for a new line
            </span>
            {text.length >= COUNTER_FROM && (
              <span
                className={`counter${text.length >= MAX_QUESTION ? " counter--max" : ""}`}
              >
                {text.length}/{MAX_QUESTION}
              </span>
            )}
          </p>
        </div>
        <div ref={endRef} className="chat-end" />
      </div>
    </div>
  );
}
