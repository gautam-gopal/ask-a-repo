import { describe, it, expect } from "vitest";
import { chunkFile, chunkRepo, splitLines } from "../src/services/chunker.js";

const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i + 1}`);
const file = (n, path = "src/a.js") => ({ path, text: lines(n).join("\n") });
const ranges = (cs) => cs.map((c) => [c.startLine, c.endLine]);

describe("windows and line numbers", () => {
  it("overlaps windows by 10 lines with exact 1-based inclusive numbers", () => {
    const cs = chunkFile(file(120));
    expect(ranges(cs)).toEqual([
      [1, 50],
      [41, 90],
      [81, 120],
    ]);
    expect(cs[1].text).toBe(lines(120).slice(40, 90).join("\n"));
    expect(cs[0].text.split("\n").slice(-10)).toEqual(
      cs[1].text.split("\n").slice(0, 10),
    );
  });

  it("exact multiple of the step ends cleanly with no extra chunk", () => {
    expect(ranges(chunkFile(file(90)))).toEqual([
      [1, 50],
      [41, 90],
    ]);
    expect(ranges(chunkFile(file(100)))).toEqual([
      [1, 50],
      [41, 90],
      [81, 100],
    ]);
  });

  it("final partial window is not a tiny duplicate", () => {
    expect(ranges(chunkFile(file(95)))).toEqual([
      [1, 50],
      [41, 90],
      [81, 95],
    ]);
    const o = { windowLines: 5, overlapLines: 2 };
    expect(ranges(chunkFile(file(8), o))).toEqual([
      [1, 5],
      [4, 8],
    ]);
    expect(ranges(chunkFile(file(10), o))).toEqual([
      [1, 5],
      [4, 8],
      [7, 10],
    ]);
  });

  it("file shorter than the window gives one chunk", () => {
    expect(ranges(chunkFile(file(3)))).toEqual([[1, 3]]);
  });

  it("one-line file", () => {
    const cs = chunkFile({ path: "a.js", text: "const x = 1;" });
    expect(ranges(cs)).toEqual([[1, 1]]);
    expect(cs[0].text).toBe("const x = 1;");
  });

  it("embedText is 'File: <path>' + LF + text", () => {
    const [c] = chunkFile({ path: "src/auth.js", text: "a\nb" });
    expect(c.embedText).toBe("File: src/auth.js\na\nb");
  });
});

describe("empty and blank input", () => {
  it.each([
    ["empty", ""],
    ["spaces", "   "],
    ["newlines", "\n\n\n"],
    ["tabs", "\t\n \n"],
  ])("%s file gives no chunks", (_n, text) => {
    expect(chunkFile({ path: "a.js", text })).toEqual([]);
  });

  it("skips a blank-only window but keeps numbering", () => {
    const text = ["a", "", "", "", "b"].join("\n");
    const cs = chunkFile(
      { path: "a.js", text },
      { windowLines: 2, overlapLines: 0 },
    );
    expect(ranges(cs)).toEqual([
      [1, 2],
      [5, 5],
    ]);
  });
});

describe("line endings", () => {
  it("normalises CRLF and CR to LF", () => {
    expect(chunkFile({ path: "a", text: "a\r\nb\r\nc" })[0].text).toBe(
      "a\nb\nc",
    );
    expect(chunkFile({ path: "a", text: "a\rb\rc" })[0].text).toBe("a\nb\nc");
    expect(chunkFile({ path: "a", text: "a\r\nb\rc\nd" })[0].text).toBe(
      "a\nb\nc\nd",
    );
  });

  it("a trailing newline creates no phantom last line", () => {
    const [c] = chunkFile({ path: "a", text: "a\nb\n" });
    expect(c.endLine).toBe(2);
    expect(c.text).toBe("a\nb");
    expect(chunkFile({ path: "a", text: "a\r\nb\r\n" })[0].endLine).toBe(2);
  });

  it("removes only one trailing newline", () => {
    const [c] = chunkFile({ path: "a", text: "a\nb\n\n" });
    expect(c.endLine).toBe(3);
    expect(c.text).toBe("a\nb\n");
  });
});

describe("maxChunkChars", () => {
  it("splits a single very long line into segments that keep its number", () => {
    const cs = chunkFile(
      { path: "a", text: "x".repeat(25) },
      { maxChunkChars: 10 },
    );
    expect(cs.map((c) => c.text.length)).toEqual([10, 10, 5]);
    expect(cs.every((c) => c.startLine === 1 && c.endLine === 1)).toBe(true);
    expect(cs.map((c) => c.text).join("")).toBe("x".repeat(25));
  });

  it("shortens a window at a line boundary to fit", () => {
    const text = Array(5).fill("a".repeat(9)).join("\n");
    const cs = chunkFile(
      { path: "a", text },
      { windowLines: 10, overlapLines: 2, maxChunkChars: 20 },
    );
    expect(ranges(cs)).toEqual([
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
    ]);
    expect(cs.every((c) => c.text.length <= 20)).toBe(true);
  });

  it("long line inside a window: neighbours stay, no redundant overlap chunks", () => {
    const text = ["a", "b", "c", "X".repeat(30), "d"].join("\n");
    const cs = chunkFile(
      { path: "a", text },
      { windowLines: 10, overlapLines: 2, maxChunkChars: 10 },
    );
    expect(ranges(cs)).toEqual([
      [1, 3],
      [4, 4],
      [4, 4],
      [4, 4],
      [5, 5],
    ]);
  });
});

describe("options", () => {
  it.each([
    ["windowLines 0", { windowLines: 0 }],
    ["windowLines 1.5", { windowLines: 1.5 }],
    ["overlapLines -1", { overlapLines: -1 }],
    ["overlap equal to window", { windowLines: 5, overlapLines: 5 }],
    ["overlap above window", { windowLines: 5, overlapLines: 9 }],
    ["maxChunkChars 0", { maxChunkChars: 0 }],
    ["windowLines NaN", { windowLines: NaN }],
  ])("throws on %s", (_n, o) => {
    expect(() => chunkFile(file(3), o)).toThrow(RangeError);
  });

  it("is deterministic", () => {
    const f = file(137);
    expect(chunkFile(f)).toEqual(chunkFile(f));
  });
});

describe("property check on generated input", () => {
  const rng = (seed) => {
    let s = seed;
    return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  };
  const generate = (seed) => {
    const r = rng(seed);
    const out = Array.from({ length: 300 }, (_, i) => {
      const x = r();
      if (x < 0.15) return "";
      if (x < 0.2) return "   ";
      if (x < 0.25) return "x".repeat(30 + Math.floor(r() * 40));
      return `code ${i}`;
    });
    return out.join(seed % 2 ? "\r\n" : "\n");
  };

  const check = (source, chunks, maxChunkChars) => {
    const ls = splitLines(source);
    const covered = new Set();
    for (const c of chunks) {
      expect(c.startLine).toBeGreaterThanOrEqual(1);
      expect(c.endLine).toBeLessThanOrEqual(ls.length);
      expect(c.startLine).toBeLessThanOrEqual(c.endLine);
      expect(c.text.length).toBeLessThanOrEqual(maxChunkChars);
      if (
        c.startLine === c.endLine &&
        ls[c.startLine - 1].length > maxChunkChars
      ) {
        expect(ls[c.startLine - 1]).toContain(c.text);
      } else {
        expect(c.text).toBe(ls.slice(c.startLine - 1, c.endLine).join("\n"));
      }
      for (let l = c.startLine; l <= c.endLine; l++) covered.add(l);
    }
    ls.forEach((l, i) => {
      if (l.trim() !== "") expect(covered.has(i + 1)).toBe(true);
    });
  };

  it.each([
    [50, 10, 4000],
    [7, 3, 60],
    [1, 0, 20],
    [5, 4, 15],
    [3, 0, 100],
  ])(
    "window %i overlap %i max %i",
    (windowLines, overlapLines, maxChunkChars) => {
      for (const seed of [1, 2, 3, 4]) {
        const source = generate(seed);
        const chunks = chunkFile(
          { path: "g.js", text: source },
          { windowLines, overlapLines, maxChunkChars },
        );
        check(source, chunks, maxChunkChars);
      }
    },
  );
});

describe("chunkRepo", () => {
  it("returns chunks and stats", () => {
    const { chunks, stats } = chunkRepo([
      { path: "a.js", text: "ab\ncd\nef" },
      { path: "b.js", text: "xyz" },
      { path: "empty.js", text: "" },
    ]);
    expect(chunks.map((c) => c.path)).toEqual(["a.js", "b.js"]);
    expect(stats).toEqual({ files: 3, chunks: 2, avgChars: 5.5, maxChars: 8 });
  });

  it("handles no files", () => {
    expect(chunkRepo([]).stats).toEqual({
      files: 0,
      chunks: 0,
      avgChars: 0,
      maxChars: 0,
    });
  });
});
