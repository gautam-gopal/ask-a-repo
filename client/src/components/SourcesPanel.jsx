import { useEffect, useRef, useState } from "react";
import {
  isGithubUrl,
  middleTruncate,
  summarizeSources,
} from "../chatHelpers.js";

const FLASH_MS = 1600;

// target = { msgId, n } set by a citation chip click. Expands, scrolls, flashes, focuses.
export default function SourcesPanel({
  msgId,
  sources,
  isLatest,
  target,
  hoverN,
}) {
  const { list, label } = summarizeSources(sources);
  const [userOpen, setUserOpen] = useState(null); // null = follow the default
  const [flash, setFlash] = useState(null);
  const rows = useRef(new Map());
  const pending = useRef(null);
  const timer = useRef(0);
  const open = userOpen ?? isLatest;
  const listId = `sources-${msgId}`;

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (!target || target.msgId !== msgId) return;
    pending.current = target.n;
    setUserOpen(true);
  }, [target, msgId]);

  useEffect(() => {
    if (pending.current === null || !open) return;
    const n = pending.current;
    pending.current = null;
    const el = rows.current.get(n);
    if (!el) return;
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    el.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      block: "center",
    });
    el.focus({ preventScroll: true });
    clearTimeout(timer.current);
    setFlash(null); // clear first so a repeat click flashes again
    requestAnimationFrame(() => setFlash(n));
    timer.current = setTimeout(() => setFlash(null), FLASH_MS);
  }, [open, target]);

  if (list.length === 0) return null;

  return (
    <div className="sources">
      <button
        type="button"
        className="btn btn-ghost btn-sm sources__toggle"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setUserOpen(!open)}
      >
        <span className="sources__chev" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        <span className="sr-only">Sources: </span>
        {label}
      </button>
      <ul id={listId} className="source-list" hidden={!open}>
        {list.map((s) => {
          const lines =
            s.startLine === s.endLine
              ? `line ${s.startLine}`
              : `lines ${s.startLine}–${s.endLine}`;
          const cls = [
            "source",
            s.cited ? "source--cited" : "source--quiet",
            flash === s.n && "source--flash",
            hoverN === s.n && "source--hover",
          ]
            .filter(Boolean)
            .join(" ");
          const name = (
            <>
              <span aria-hidden="true">{middleTruncate(s.path)}</span>
              <span className="sr-only">{s.path}</span>
            </>
          );
          return (
            <li
              key={s.n}
              className={cls}
              tabIndex={-1}
              ref={(el) => {
                if (el) rows.current.set(s.n, el);
                else rows.current.delete(s.n);
              }}
            >
              <span className="source__n">[{s.n}]</span>
              <span className="source__body">
                {isGithubUrl(s.url) ? (
                  <a
                    className="source__path"
                    href={s.url}
                    title={s.path}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {name}
                    <span className="sr-only">
                      {" "}
                      (opens GitHub in a new tab)
                    </span>
                  </a>
                ) : (
                  <span className="source__path" title={s.path}>
                    {name}
                  </span>
                )}
                <span className="source__lines">{lines}</span>
              </span>
              {s.cited ? (
                <span className="badge badge-ready">cited</span>
              ) : (
                <span className="tag-quiet">retrieved, not cited</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
