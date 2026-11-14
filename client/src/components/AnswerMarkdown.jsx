/** @jsxRuntime automatic */
/** @jsxImportSource react */
// (The two pragma lines above only matter for the server's Vitest, which has no React plugin.)
// SECURITY: no dangerouslySetInnerHTML, no rehype-raw. Raw HTML in the text is escaped to plain
// text by react-markdown. Images never render. Only https://github.com/ links become anchors.
import {
  createContext,
  memo,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { isGithubUrl } from "../chatHelpers.js";
import { remarkCitations } from "../remarkCitations.js";

const CitationContext = createContext({
  sources: [],
  onClick: null,
  onHover: null,
});

function CiteChip({ n }) {
  const { sources, onClick, onHover } = useContext(CitationContext);
  const num = Number(n);
  const src = sources.find((s) => s.n === num);
  if (!src) return `[${num}]`;
  return (
    <button
      type="button"
      className="chip"
      aria-label={`Source ${num}: ${src.path}`}
      onClick={() => onClick?.(num)}
      onMouseEnter={() => onHover?.(num)}
      onMouseLeave={() => onHover?.(null)}
      onFocus={() => onHover?.(num)}
      onBlur={() => onHover?.(null)}
    >
      {`[${num}]`}
    </button>
  );
}

// The ONLY place an <a> is created. Everything else is plain text with the URL visible.
function SafeLink({ href, children }) {
  if (isGithubUrl(href))
    return (
      <a
        className="md-link"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
        <span className="sr-only"> (opens GitHub in a new tab)</span>
      </a>
    );
  const same = typeof children === "string" && children === href;
  return (
    <span className="md-link-blocked">
      {children}
      {!same && href ? <span className="md-link-url"> ({href})</span> : null}
    </span>
  );
}

// Images never render: a model-chosen URL would make the browser request it.
function NoImage({ alt }) {
  return alt ? <span>{alt}</span> : null;
}

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.className = "sr-only";
    ta.setAttribute("readonly", "");
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

const CodeBlock = memo(function CodeBlock({ lang, text }) {
  const [state, setState] = useState("idle"); // idle | copied | failed
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function onCopy() {
    const ok = await copyText(text);
    setState(ok ? "copied" : "failed");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  }
  return (
    <div className="md-code">
      <div className="md-code__head">
        <span className="md-code__lang">{lang}</span>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={onCopy}
        >
          {state === "copied"
            ? "Copied"
            : state === "failed"
              ? "Copy failed"
              : "Copy"}
        </button>
        <span className="sr-only" role="status">
          {state === "copied" ? "Copied to clipboard" : ""}
        </span>
      </div>
      <pre tabIndex={0}>
        <code>{text}</code>
      </pre>
    </div>
  );
});

// Fenced blocks arrive as <pre><code class="language-x">text</code></pre>. An unclosed fence
// while streaming is still one code node running to the end of the text.
function Pre({ children }) {
  const child = Array.isArray(children) ? children[0] : children;
  const cls =
    typeof child?.props?.className === "string" ? child.props.className : "";
  const lang = /(?:^|\s)language-([A-Za-z0-9_+#.-]{1,20})/.exec(cls)?.[1] ?? "";
  const raw = child?.props?.children;
  const text = (Array.isArray(raw) ? raw.join("") : String(raw ?? "")).replace(
    /\n$/,
    "",
  );
  return <CodeBlock lang={lang} text={text} />;
}

const heading = (Tag, cls) =>
  function Heading({ children }) {
    return <Tag className={`md-h ${cls}`}>{children}</Tag>;
  };

const ALIGNS = new Set(["left", "center", "right"]);
const cell = (Tag) =>
  function Cell({ style, children }) {
    const a = style?.textAlign;
    return (
      <Tag className={ALIGNS.has(a) ? `md-ta-${a}` : undefined}>{children}</Tag>
    );
  };

function Table({ children }) {
  return (
    <div
      className="md-table-wrap"
      tabIndex={0}
      role="region"
      aria-label="Table"
    >
      <table>{children}</table>
    </div>
  );
}

// Static object: the component types never change, so a re-render never remounts code blocks.
const COMPONENTS = {
  a: SafeLink,
  img: NoImage,
  pre: Pre,
  code: ({ children }) => <code className="md-inline-code">{children}</code>,
  h1: heading("h3", "md-h1"),
  h2: heading("h4", "md-h2"),
  h3: heading("h5", "md-h3"),
  h4: ({ children }) => (
    <p className="md-h4">
      <strong>{children}</strong>
    </p>
  ),
  h5: ({ children }) => (
    <p className="md-h4">
      <strong>{children}</strong>
    </p>
  ),
  h6: ({ children }) => (
    <p className="md-h4">
      <strong>{children}</strong>
    </p>
  ),
  table: Table,
  th: cell("th"),
  td: cell("td"),
  input: ({ type, checked }) =>
    type === "checkbox" ? (
      <input
        type="checkbox"
        checked={Boolean(checked)}
        disabled
        readOnly
        aria-label={checked ? "Done" : "Not done"}
      />
    ) : null,
  "cite-chip": CiteChip,
};

const passThrough = (url) => url; // SafeLink is the only consumer of URLs and checks them.

function AnswerMarkdown({ text, sources, onCitationClick, onCitationHover }) {
  const list = Array.isArray(sources) ? sources : [];
  const key = list.map((s) => s.n).join(",");
  const plugins = useMemo(
    () => [
      remarkGfm,
      [
        remarkCitations,
        { valid: new Set(key ? key.split(",").map(Number) : []) },
      ],
    ],
    [key],
  );
  // Re-parses only when the text or the source numbers change (once per rAF batch).
  const body = useMemo(
    () => (
      <Markdown
        remarkPlugins={plugins}
        components={COMPONENTS}
        urlTransform={passThrough}
      >
        {typeof text === "string" ? text : ""}
      </Markdown>
    ),
    [text, plugins],
  );
  const ctx = useMemo(
    () => ({
      sources: list,
      onClick: onCitationClick,
      onHover: onCitationHover,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sources, onCitationClick, onCitationHover],
  );
  return (
    <CitationContext.Provider value={ctx}>
      <div className="md">{body}</div>
    </CitationContext.Provider>
  );
}

export default memo(AnswerMarkdown);
