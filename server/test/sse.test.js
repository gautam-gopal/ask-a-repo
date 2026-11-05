import { describe, it, expect } from "vitest";
import { parseSseStream } from "../../client/src/sse.js";

const ev = (event, data) => ({ event, data });
const run = (chunks) => {
  const p = parseSseStream();
  const events = chunks.flatMap((c) => p.feed(c));
  const end = p.end();
  return { events: [...events, ...end.events], incomplete: end.incomplete };
};

const FULL =
  'event: sources\ndata: {"a":1}\n\n' +
  ": keep-alive\n\n" +
  'event: token\ndata: {"t":"x"}\n\n' +
  "event: done\r\ndata: {}\r\n\r\n";
const EXPECTED = [
  ev("sources", '{"a":1}'),
  ev("token", '{"t":"x"}'),
  ev("done", "{}"),
];

describe("frames split across chunks", () => {
  it("parses a whole stream in one chunk", () => {
    expect(run([FULL])).toEqual({ events: EXPECTED, incomplete: false });
  });

  it("gives the same result when split at every possible position", () => {
    for (let i = 0; i <= FULL.length; i++) {
      expect(run([FULL.slice(0, i), FULL.slice(i)])).toEqual({
        events: EXPECTED,
        incomplete: false,
      });
    }
  });

  it("works one character at a time", () => {
    expect(run([...FULL])).toEqual({ events: EXPECTED, incomplete: false });
  });
});

describe("field handling", () => {
  it("joins multi-line data with LF", () => {
    expect(run(["data: a\ndata: b\n\n"]).events).toEqual([
      ev("message", "a\nb"),
    ]);
  });
  it("accepts data with no space after the colon", () => {
    expect(run(["data:x\n\n"]).events).toEqual([ev("message", "x")]);
  });
  it("ignores comment lines and comment-only frames (heartbeats)", () => {
    expect(run([": hb\n\n: hb\n\n"]).events).toEqual([]);
    expect(run(["data: a\n: hb\ndata: b\n\n"]).events).toEqual([
      ev("message", "a\nb"),
    ]);
  });
  it("passes unknown events through by name", () => {
    expect(run(["event: weird\ndata: z\n\n"]).events).toEqual([
      ev("weird", "z"),
    ]);
  });
  it("does not carry an event name into the next frame", () => {
    expect(run(["event: a\ndata: 1\n\ndata: 2\n\n"]).events).toEqual([
      ev("a", "1"),
      ev("message", "2"),
    ]);
  });
});

describe("line endings", () => {
  it("handles CRLF", () => {
    expect(run(["event: t\r\ndata: 1\r\n\r\n"]).events).toEqual([ev("t", "1")]);
  });
  it("handles CR and LF arriving in different chunks", () => {
    expect(run(["data: x\r", "\n\r", "\ndata: y\r\n\r\n"]).events).toEqual([
      ev("message", "x"),
      ev("message", "y"),
    ]);
  });
  it("treats lone CR as a line end, including a CR CR at EOF", () => {
    expect(run(["data: x\r\r"])).toEqual({
      events: [ev("message", "x")],
      incomplete: false,
    });
  });
});

describe("end of stream", () => {
  it("discards a final partial frame and reports it", () => {
    const r = run(['event: token\ndata: {"t":"a"}\n\nevent: tok']);
    expect(r.events).toEqual([ev("token", '{"t":"a"}')]);
    expect(r.incomplete).toBe(true);
  });
  it("a frame without its blank line is not dispatched", () => {
    expect(run(["event: done\ndata: {}\n"])).toEqual({
      events: [],
      incomplete: true,
    });
  });
  it("a clean end is not incomplete", () => {
    expect(run(["data: a\n\n"]).incomplete).toBe(false);
    expect(run([""]).incomplete).toBe(false);
  });
});

describe("multi-byte characters (with TextDecoder stream: true)", () => {
  const bytes = new TextEncoder().encode(
    'event: token\ndata: {"t":"é✓😀"}\n\n',
  );

  it("decodes characters split across byte chunks", () => {
    const dec = new TextDecoder("utf-8");
    const p = parseSseStream();
    const out = [];
    for (const b of bytes)
      out.push(...p.feed(dec.decode(Uint8Array.of(b), { stream: true })));
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0].data).t).toBe("é✓😀");
  });

  it("proves stream: true is needed: per-chunk decoding corrupts", () => {
    const dec = new TextDecoder("utf-8");
    let s = "";
    for (const b of bytes) s += dec.decode(Uint8Array.of(b));
    expect(s).toContain("\uFFFD");
  });
});
