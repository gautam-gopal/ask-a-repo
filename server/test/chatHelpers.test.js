import { describe, it, expect } from "vitest";
import {
  linkifyCitations,
  orderSources,
  isGithubUrl,
  formatAskError,
} from "../../client/src/chatHelpers.js";

const src = (...ns) => ns.map((n) => ({ n }));
const t = (text) => ({ type: "text", text });
const c = (n) => ({ type: "cite", n });

describe("linkifyCitations", () => {
  it.each([[""], [null], [undefined], [42]])("%j gives no segments", (x) =>
    expect(linkifyCitations(x, src(1))).toEqual([]),
  );

  it("no markers: one text segment, newlines preserved", () => {
    expect(linkifyCitations("line one\nline two", src(1))).toEqual([
      t("line one\nline two"),
    ]);
  });

  it("one marker", () => {
    expect(linkifyCitations("See [1].", src(1))).toEqual([
      t("See "),
      c(1),
      t("."),
    ]);
  });

  it("several markers", () => {
    expect(linkifyCitations("A [1] and B [2] and C [1].", src(1, 2))).toEqual([
      t("A "),
      c(1),
      t(" and B "),
      c(2),
      t(" and C "),
      c(1),
      t("."),
    ]);
  });

  it("adjacent markers", () => {
    expect(linkifyCitations("x [1][2]", src(1, 2))).toEqual([
      t("x "),
      c(1),
      c(2),
    ]);
  });

  it("grouped markers", () => {
    expect(linkifyCitations("[1, 3]", src(1, 3))).toEqual([c(1), c(3)]);
  });

  it("out of range stays plain text and merges with neighbours", () => {
    expect(linkifyCitations("a [9] b", src(1))).toEqual([t("a [9] b")]);
    expect(linkifyCitations("[0]", src(1))).toEqual([t("[0]")]);
  });

  it("group with one invalid number keeps the valid chip", () => {
    expect(linkifyCitations("[1, 9]", src(1))).toEqual([c(1), t("[9]")]);
  });

  it("brackets in code are not citations", () => {
    expect(linkifyCitations("Use `items[1]` here [1]", src(1))).toEqual([
      t("Use `items[1]` here "),
      c(1),
    ]);
    expect(
      linkifyCitations("```js\nconst a = b[1];\n```\n[1]", src(1)),
    ).toEqual([t("```js\nconst a = b[1];\n```\n"), c(1)]);
    expect(linkifyCitations("arr[1] and f(x)[1] and [1]", src(1))).toEqual([
      t("arr[1] and f(x)[1] and "),
      c(1),
    ]);
  });

  it("Unicode form is recognised and normalised", () => {
    expect(linkifyCitations("x 【1】 y 【2, 3】", src(1, 2, 3))).toEqual([
      t("x "),
      c(1),
      t(" y "),
      c(2),
      c(3),
    ]);
    expect(linkifyCitations("bad 【9】", src(1))).toEqual([t("bad [9]")]);
  });

  it("mixed ASCII and Unicode", () => {
    expect(linkifyCitations("[1] 【2】", src(1, 2))).toEqual([
      c(1),
      t(" "),
      c(2),
    ]);
  });

  it("no sources: nothing becomes a chip", () => {
    expect(linkifyCitations("A [1].", [])).toEqual([t("A [1].")]);
    expect(linkifyCitations("A [1].", undefined)).toEqual([t("A [1].")]);
  });

  it("never emits anything but text and cite segments", () => {
    const segs = linkifyCitations("<img src=x onerror=alert(1)> [1]", src(1));
    expect(segs).toEqual([t("<img src=x onerror=alert(1)> "), c(1)]);
  });
});

describe("orderSources", () => {
  it("cited first, then by number, without mutating", () => {
    const input = [
      { n: 1, cited: false },
      { n: 2, cited: true },
      { n: 3, cited: false },
      { n: 4, cited: true },
    ];
    expect(orderSources(input).map((s) => s.n)).toEqual([2, 4, 1, 3]);
    expect(input.map((s) => s.n)).toEqual([1, 2, 3, 4]);
  });
  it("handles bad input", () => {
    expect(orderSources(undefined)).toEqual([]);
  });
});

describe("isGithubUrl", () => {
  it.each([
    ["https://github.com/o/r/blob/abc/a.js#L1-L2", true],
    ["http://github.com/o/r", false],
    ["https://github.com.evil.com/o/r", false],
    ["https://evilgithub.com/o/r", false],
    ["https://github.com", false],
    ["javascript:alert(1)", false],
    ["data:text/html,x", false],
    ["", false],
    [undefined, false],
    [{}, false],
  ])("%j -> %s", (u, ok) => expect(isGithubUrl(u)).toBe(ok));
});

describe("formatAskError", () => {
  it.each([
    ["VALIDATION_ERROR", /1 to 500/],
    ["QUOTA_EXHAUSTED", /midnight UTC/],
    ["EMBEDDING_RATE_LIMITED", /minute/],
    ["LLM_RATE_LIMITED", /minute/],
    ["UPSTREAM_TIMEOUT", /too long/],
    ["ANSWER_FAILED", /try again/i],
    ["REPO_NOT_READY", /not ready/],
  ])("maps %s", (code, re) =>
    expect(formatAskError({ code, message: "raw" })).toMatch(re),
  );
  it("falls back to the error message, then generic", () => {
    expect(formatAskError({ code: "NETWORK", message: "Cannot reach." })).toBe(
      "Cannot reach.",
    );
    expect(formatAskError(undefined)).toMatch(/Something went wrong/);
  });
  it("ignores Object.prototype keys", () => {
    expect(formatAskError({ code: "toString", message: "m" })).toBe("m");
  });
});
