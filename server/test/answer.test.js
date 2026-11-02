import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { config } from "../src/config.js";
import { answerQuestion } from "../src/services/answer.js";

let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const reply = (text) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: text } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { status: 200 },
  );
const hit = (path, score) => ({
  path,
  startLine: 1,
  endLine: 5,
  text: "code",
  score,
});
const HIGH = config.SEARCH_MIN_SCORE + 0.3;
const LOW = config.SEARCH_MIN_SCORE - 0.3;

describe("answerQuestion", () => {
  it("skips the LLM when the best score is below the threshold", async () => {
    const r = await answerQuestion({
      question: "q",
      hits: [hit("a.js", LOW), hit("b.js", LOW - 0.1)],
    });
    expect(r).toEqual({ notFound: true, answer: null, sources: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips the LLM when there are no hits", async () => {
    const r = await answerQuestion({ question: "q", hits: [] });
    expect(r.notFound).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips the LLM when no excerpt fits the budget", async () => {
    const r = await answerQuestion({
      question: "q",
      hits: [{ ...hit("a.js", HIGH), text: "x".repeat(20000) }],
    });
    expect(r.notFound).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("normal flow: answer, cited flags, model, usage", async () => {
    fetchMock.mockResolvedValueOnce(reply("Auth lives in a.js [1]."));
    const r = await answerQuestion({
      question: "where is auth",
      hits: [hit("a.js", HIGH), hit("b.js", HIGH - 0.1)],
    });
    expect(r.notFound).toBe(false);
    expect(r.answer).toBe("Auth lives in a.js [1].");
    expect(r.sources.map((s) => [s.n, s.path, s.cited])).toEqual([
      [1, "a.js", true],
      [2, "b.js", false],
    ]);
    expect(r.model).toBe(config.GROQ_MODEL);
    expect(r.usedFallback).toBe(false);
    expect(r.usage.totalTokens).toBe(2);
    expect(r.promptTokensEstimate).toBeGreaterThan(0);
  });

  it("drops a fabricated citation number", async () => {
    fetchMock.mockResolvedValueOnce(reply("See [1] and also [7]."));
    const r = await answerQuestion({
      question: "q",
      hits: [hit("a.js", HIGH)],
    });
    expect(r.answer).not.toContain("[7]");
    expect(r.sources).toHaveLength(1);
    expect(r.sources[0].cited).toBe(true);
  });

  it("returns a model 'not in the excerpts' reply as a normal answer", async () => {
    fetchMock.mockResolvedValueOnce(
      reply("The provided excerpts do not contain the answer."),
    );
    const r = await answerQuestion({
      question: "q",
      hits: [hit("a.js", HIGH)],
    });
    expect(r.notFound).toBe(false);
    expect(r.answer).toMatch(/do not contain the answer/);
    expect(r.sources[0].cited).toBe(false);
  });
});
