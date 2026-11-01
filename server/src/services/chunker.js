// Pure line-window chunker. No I/O, no network, no database.
export const DEFAULTS = Object.freeze({
  windowLines: 50,
  overlapLines: 10,
  maxChunkChars: 4000,
});

// CRLF and CR become LF. Exactly one trailing newline is a terminator, not a line.
export function splitLines(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function validate({ windowLines, overlapLines, maxChunkChars }) {
  if (!Number.isInteger(windowLines) || windowLines < 1)
    throw new RangeError("windowLines must be an integer >= 1");
  if (!Number.isInteger(overlapLines) || overlapLines < 0)
    throw new RangeError("overlapLines must be an integer >= 0");
  if (overlapLines >= windowLines)
    throw new RangeError("overlapLines must be less than windowLines");
  if (!Number.isInteger(maxChunkChars) || maxChunkChars < 1)
    throw new RangeError("maxChunkChars must be an integer >= 1");
}

export function chunkFile({ path, text }, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  validate(opts);
  if (typeof path !== "string" || typeof text !== "string")
    throw new TypeError("path and text must be strings");

  const { windowLines, overlapLines, maxChunkChars } = opts;
  const lines = splitLines(text);
  const n = lines.length;
  const chunks = [];

  const push = (startLine, endLine, body) => {
    if (body.trim() === "") return; // blank or whitespace-only: skip
    chunks.push({
      path,
      startLine,
      endLine,
      text: body,
      embedText: `File: ${path}\n${body}`,
    });
  };

  // Exclusive end of the window starting at `start`: up to windowLines lines,
  // shortened at a line boundary until the text fits maxChunkChars (min 1 line).
  const fit = (start) => {
    const limit = Math.min(start + windowLines, n);
    let size = 0;
    let end = start;
    while (end < limit) {
      const add = lines[end].length + (end > start ? 1 : 0); // +1 for the LF
      if (end > start && size + add > maxChunkChars) break;
      size += add;
      end++;
    }
    return end;
  };

  let start = 0;
  let covered = 0; // exclusive end of the furthest line already emitted
  while (start < n) {
    let end = fit(start);
    // Overlap OVERRIDE: if the char cap shortened the window so it adds no new
    // line, the overlapped window would only repeat the previous chunk. Skip
    // the overlap and begin at the first uncovered line instead.
    if (end <= covered) {
      start = covered;
      end = fit(start);
    }

    if (end - start === 1 && lines[start].length > maxChunkChars) {
      // A single over-long line: split into character segments. Every segment
      // keeps this line's number, and segments never overlap each other.
      const line = lines[start];
      for (let i = 0; i < line.length; i += maxChunkChars)
        push(start + 1, start + 1, line.slice(i, i + maxChunkChars));
    } else {
      push(start + 1, end, lines.slice(start, end).join("\n"));
    }

    covered = end;
    if (end >= n) break; // the last window reached EOF: no tiny contained tail
    start = Math.max(end - overlapLines, start + 1);
  }
  return chunks;
}

export function chunkRepo(files, options = {}) {
  const chunks = files.flatMap((f) => chunkFile(f, options));
  const total = chunks.reduce((sum, c) => sum + c.text.length, 0);
  const stats = {
    files: files.length,
    chunks: chunks.length,
    avgChars: chunks.length ? Math.round((total / chunks.length) * 10) / 10 : 0,
    maxChars: chunks.reduce((m, c) => Math.max(m, c.text.length), 0),
  };
  return { chunks, stats };
}
