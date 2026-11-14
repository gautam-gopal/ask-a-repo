import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import AnswerMarkdown from "../../client/src/components/AnswerMarkdown.jsx";
import { splitCitations } from "../../client/src/remarkCitations.js";

// React is resolved from client/ so the component and this test share one React copy.
const req = createRequire(
  new URL("../../client/package.json", import.meta.url),
);
const React = req("react");
const { renderToStaticMarkup } = req("react-dom/server");

const SOURCES = [
  { n: 1, path: "src/a.js" },
  { n: 2, path: "src/b.js" },
];
const render = (text, sources = SOURCES) =>
  renderToStaticMarkup(React.createElement(AnswerMarkdown, { text, sources }));
const tagsOf = (html) => html.match(/<[a-zA-Z][^>]*>/g) ?? []; // real tags only; text is escaped
const count = (html, s) => html.split(s).length - 1;

function assertSafe(html) {
  for (const tag of tagsOf(html)) {
    expect(tag).not.toMatch(
      /^<(script|iframe|img|object|embed|style|svg|form|link|meta|base)\b/i,
    );
    expect(tag).not.toMatch(/\son\w+\s*=/i);
    expect(tag).not.toMatch(/\s(src|srcset|style|srcdoc)\s*=/i);
    const href = /\shref="([^"]*)"/.exec(tag)?.[1];
    if (href !== undefined)
      expect(href.startsWith("https://github.com/")).toBe(true);
  }
  expect(html).not.toContain("<!--");
}

const GH = "https://github.com/owner/repo/blob/sha/file#L1-L5";
const ATTACKS = [
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  '<iframe src="https://evil.example"></iframe>',
  "<!-- hidden -->\ntext",
  "[x](javascript:alert(1))",
  "[x](data:text/html,<script>alert(1)</script>)",
  "[x](//evil.example)",
  "[x](JaVaScRiPt:alert(1))",
  "[x](&#106;avascript:alert(1))",
  "[x](&#x6A;avascript&colon;alert(1))",
  "[x](vbscript:msgbox(1))",
  "![tracker](https://evil.example/p.png)",
  "[evil](https://evil.example)",
  "https://evil.example/auto",
  "<https://evil.example>",
  "a".repeat(5000),
  "**[a](<b>*c_`d\n> - [x](javascript:1)\n\n| a |\n|-|\n| [y](javascript:2) |",
  "[[[x](javascript:1)](javascript:2)](javascript:3)",
  "![[x](javascript:alert(1))](javascript:alert(2))",
  `[ok](${GH}) and [bad](javascript:alert(1)) <img src=x onerror=1>`,
];

describe("security: hostile input never produces active markup", () => {
  it.each(ATTACKS.map((a) => [a.slice(0, 40), a]))("%s", (_n, input) => {
    assertSafe(render(input));
  });

  it("raw HTML is escaped to visible text, not dropped and not rendered", () => {
    const html = render("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script");
  });

  it("javascript:, data:, protocol-relative and other-host links are text, never href", () => {
    for (const md of [
      "[x](javascript:alert(1))",
      "[x](JaVaScRiPt:alert(1))",
      "[x](data:text/html,hi)",
      "[x](//evil.example)",
      "[evil](https://evil.example)",
    ])
      expect(render(md)).not.toContain("href=");
    expect(render("[x](javascript:alert(1))")).toContain("javascript:alert(1)");
    expect(render("[evil](https://evil.example)")).toContain(
      "https://evil.example",
    );
  });

  it("images render nothing but their alt text", () => {
    const html = render("![tracker](https://evil.example/p.png)");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("p.png");
    expect(html).not.toContain("evil.example");
    expect(html).toContain("tracker");
  });

  it("a GitHub link is the only anchor allowed", () => {
    const html = render(`[see](${GH})`);
    expect(html).toContain(`href="${GH}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("a very long unbroken line renders safely inside the answer", () => {
    const html = render("x".repeat(20000));
    expect(html).toContain("x".repeat(20000));
    assertSafe(html);
  });
});

describe("formatting", () => {
  it("answer with no Markdown is one paragraph", () => {
    expect(render("Hello world")).toBe(
      '<div class="md"><p>Hello world</p></div>',
    );
  });
  it("bold, italic, strikethrough, inline code", () => {
    const html = render("**b** *i* ~~s~~ `c`");
    expect(html).toContain("<strong>b</strong>");
    expect(html).toContain("<em>i</em>");
    expect(html).toContain("<del>s</del>");
    expect(html).toContain('<code class="md-inline-code">c</code>');
  });
  it("fenced block with a language label and a Copy button", () => {
    const html = render("```js\nconst a = 1;\n```");
    expect(html).toContain('<span class="md-code__lang">js</span>');
    expect(html).toContain(">Copy<");
    expect(html).toContain('<pre tabindex="0"><code>const a = 1;</code></pre>');
  });
  it("an unclosed fence renders as a code block to the end", () => {
    const html = render("Intro\n\n```js\nconst a = [1];\nmore");
    expect(html).toContain("md-code");
    expect(html).toContain("const a = [1];\nmore");
    expect(count(html, 'class="chip"')).toBe(0);
  });
  it("lists and task lists", () => {
    expect(render("- a\n- b")).toContain("<ul>");
    expect(render("1. a\n2. b")).toContain("<ol>");
    const t = render("- [x] done\n- [ ] todo");
    expect(t).toContain('type="checkbox"');
    expect(t).toContain("disabled");
  });
  it("tables sit inside the scroll wrapper", () => {
    const html = render("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(html).toMatch(/<div class="md-table-wrap"[^>]*><table>/);
    expect(html).toContain("<th>a</th>");
  });
  it("heading levels are shifted down; deeper ones are bold text", () => {
    const html = render("# A\n## B\n### C\n#### D");
    expect(html).toContain('<h3 class="md-h md-h1">A</h3>');
    expect(html).toContain('<h4 class="md-h md-h2">B</h4>');
    expect(html).toContain('<h5 class="md-h md-h3">C</h5>');
    expect(html).toContain('<p class="md-h4"><strong>D</strong></p>');
    expect(html).not.toMatch(/<h[12][ >]/);
  });
});

describe("citations", () => {
  it("chips only for valid n; others stay literal", () => {
    const html = render("See [1] and [2] and [9].");
    expect(count(html, 'class="chip"')).toBe(2);
    expect(html).toContain('aria-label="Source 1: src/a.js"');
    expect(html).toContain("[9]");
  });
  it("adjacent markers and groups", () => {
    expect(count(render("x [1][2]"), 'class="chip"')).toBe(2);
    expect(count(render("x [1, 2]"), 'class="chip"')).toBe(2);
  });
  it("Unicode form is recognised and normalised", () => {
    const html = render("x 【1】 y 【9】");
    expect(count(html, 'class="chip"')).toBe(1);
    expect(html).toContain("[9]");
    expect(html).not.toContain("【");
  });
  it("partial markers while streaming stay plain text", () => {
    for (const s of ["see [1", "see [1, ", "see 【2"]) {
      const html = render(s);
      expect(count(html, 'class="chip"')).toBe(0);
      expect(html).toContain(s.trim());
    }
  });
  it("never inside inline code, fenced code, or after a word character", () => {
    expect(count(render("`arr[1]`"), 'class="chip"')).toBe(0);
    expect(render("`arr[1]`")).toContain("arr[1]");
    const fenced = render("```\narr[1]\n```");
    expect(count(fenced, 'class="chip"')).toBe(0);
    expect(fenced).toContain("arr[1]");
    expect(count(render("use arr[1] here"), 'class="chip"')).toBe(0);
  });
  it("chips work inside bold and lists", () => {
    expect(count(render("**see [1]**\n\n- item [2]"), 'class="chip"')).toBe(2);
  });
  it("no sources means no chips", () => {
    expect(count(render("See [1].", []), 'class="chip"')).toBe(0);
  });
  it("splitCitations keeps an all-invalid group exactly as written", () => {
    expect(splitCitations("a [7, 8] b", new Set([1]))).toEqual([
      { type: "text", value: "a [7, 8] b" },
    ]);
  });

  it("annotated ASCII citation becomes a chip; the annotation is discarded", () => {
    const html = render("See [1†lines=90-131].");
    expect(count(html, 'class="chip"')).toBe(1);
    expect(html).not.toMatch(/lines=|90-131|†/);
  });
  it("annotated Unicode citation becomes a chip", () => {
    const html = render("See 【2†lines=519-550】.");
    expect(count(html, 'class="chip"')).toBe(1);
    expect(html).not.toMatch(/lines=|519-550|†|【/);
  });
  it("multiple and grouped annotated citations", () => {
    expect(
      count(render("a [1†lines=1-5] b 【2†lines=3-4】"), 'class="chip"'),
    ).toBe(2);
    expect(count(render("x [1†lines=1-5, 2]"), 'class="chip"')).toBe(2);
    expect(count(render("x [1†lines=1-5][2†lines=7-9]"), 'class="chip"')).toBe(
      2,
    );
  });
  it("invalid annotated numbers never become chips", () => {
    const html = render("a [9†lines=1-2] b 【7†lines=3-4】");
    expect(count(html, 'class="chip"')).toBe(0);
    expect(html).toContain("[9]");
    expect(html).toContain("[7]");
    expect(html).not.toMatch(/lines=|†|【/);
  });
  it("a group with one invalid number keeps only the valid chip", () => {
    const html = render("[1†lines=1-5, 9†lines=2-3]");
    expect(count(html, 'class="chip"')).toBe(1);
    expect(html).toContain("[9]");
  });
  it("model-supplied lines are ignored: the chip label comes from sources", () => {
    const html = render("Auth [1†lines=999-1000].");
    expect(html).toContain('aria-label="Source 1: src/a.js"');
    expect(html).not.toMatch(/999|1000|lines=/);
  });
  it("annotated markers are never chips in inline or fenced code", () => {
    const inline = render("`items[1†lines=1-2]` and `[1†lines=1-2]`");
    expect(count(inline, 'class="chip"')).toBe(0);
    expect(inline).toContain("items[1†lines=1-2]");
    const fenced = render("```\n[1†lines=1-2]\n```");
    expect(count(fenced, 'class="chip"')).toBe(0);
    expect(fenced).toContain("[1†lines=1-2]");
    expect(count(render("use arr[1†lines=1-2] here"), 'class="chip"')).toBe(0);
  });
  it("annotated markers are never chips inside links or images", () => {
    expect(count(render(`[see [1†lines=1-2]](${GH})`), 'class="chip"')).toBe(0);
    expect(
      count(
        render("![alt [1†lines=1-2]](https://evil.example/p.png)"),
        'class="chip"',
      ),
    ).toBe(0);
  });
  it("partial annotated markers while streaming stay plain text", () => {
    for (const s of [
      "see [1†lines=90",
      "see [1†lines=90-131",
      "see 【1†lines=9",
    ]) {
      const html = render(s);
      expect(count(html, 'class="chip"')).toBe(0);
      expect(html).toContain(s.trim());
    }
  });
  it("splitCitations: annotated numbers resolve to plain cite nodes", () => {
    expect(splitCitations("a [1†lines=5-9] b", new Set([1]))).toEqual([
      { type: "text", value: "a " },
      { type: "cite", n: 1 },
      { type: "text", value: " b" },
    ]);
    expect(splitCitations("a [7†lines=1-2] b", new Set([1]))).toEqual([
      { type: "text", value: "a [7] b" },
    ]);
  });
});
