// Each number may carry a model-made "†lines=START-END" annotation. It is parsed away and
// never used: only the number is read, and it must be in `valid` (the server's sources).
const ITEM = String.raw`\d+(?:†lines=\d+(?:-\d+)?)?`;
const LIST = String.raw`${ITEM}(?:\s*,\s*${ITEM})*`;
const CITE_RE = new RegExp(
  String.raw`(?<![\w)])\[(${LIST})\]|【\s*(${LIST})\s*】`,
  "g",
);
const SKIP = new Set([
  "code",
  "inlineCode",
  "html",
  "link",
  "linkReference",
  "image",
  "imageReference",
  "definition",
]);

// One string in, [{ type: "text", value } | { type: "cite", n }] out.
// An ASCII marker right after a word character or ")" (arr[1], f(x)[1]) is code, not a citation.
// A marker with no valid number stays text (Unicode form normalised to [n]).
export function splitCitations(text, valid) {
  const out = [];
  let pos = 0;
  const push = (t) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last?.type === "text") last.value += t;
    else out.push({ type: "text", value: t });
  };
  for (const m of text.matchAll(CITE_RE)) {
    push(text.slice(pos, m.index));
    pos = m.index + m[0].length;
    const nums = (m[1] ?? m[2]).split(",").map((s) => Number(/\d+/.exec(s)[0])); // number only; annotation dropped
    if (!nums.some((n) => valid.has(n))) {
      // Unchanged text as written, unless it carried an annotation (then normalised).
      push(
        m[1] !== undefined && !m[0].includes("†")
          ? m[0]
          : `[${nums.join(", ")}]`,
      );
      continue;
    }
    for (const n of nums) {
      if (valid.has(n)) out.push({ type: "cite", n });
      else push(`[${n}]`);
    }
  }
  push(text.slice(pos));
  return out;
}

const citationNode = (n) => ({
  type: "citation",
  children: [],
  data: { hName: "cite-chip", hProperties: { n: String(n) } },
});

function walk(node, valid) {
  if (!Array.isArray(node.children) || SKIP.has(node.type)) return;
  const next = [];
  for (const child of node.children) {
    if (child.type === "text") {
      for (const seg of splitCitations(child.value, valid))
        next.push(
          seg.type === "text"
            ? { type: "text", value: seg.value }
            : citationNode(seg.n),
        );
    } else {
      walk(child, valid);
      next.push(child);
    }
  }
  node.children = next;
}

// Use as [remarkCitations, { valid: Set<number> }].
export function remarkCitations({ valid }) {
  return (tree) => {
    if (valid && valid.size > 0) walk(tree, valid);
  };
}
