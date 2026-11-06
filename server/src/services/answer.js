import { config } from "../config.js";
import { generate, generateStream } from "./llm.js";
import { buildMessages, extractCitations } from "./prompt.js";

// SEARCH_MIN_SCORE is PROVISIONAL (default 0.79, D-084), based on the
// threshold sweep across 30 on-topic and 8 off-topic questions.
// BGE cosine scores are compressed (D-023), so on-topic and off-topic
// ranges overlap and this gate only catches the clearest misses.
// The prompt's "excerpts do not contain the answer" rule is the second layer.
const NOT_FOUND = Object.freeze({ notFound: true, answer: null, sources: [] });

export async function answerQuestion(
  { question, hits, history = [] },
  options,
) {
  if (
    !Array.isArray(hits) ||
    hits.length === 0 ||
    Math.max(...hits.map((h) => h.score)) < config.SEARCH_MIN_SCORE
  )
    return { ...NOT_FOUND, sources: [] }; // no LLM call

  const { messages, usedHits, promptTokensEstimate } = buildMessages({
    question,
    hits,
    history,
  });
  if (usedHits.length === 0) return { ...NOT_FOUND, sources: [] }; // nothing fit the budget

  const gen = await generate({ messages }, options);
  const { cited, text } = extractCitations(gen.text, usedHits.length);
  return {
    notFound: false,
    answer: text,
    sources: usedHits.map((h) => ({ ...h, cited: cited.includes(h.n) })),
    model: gen.model,
    usedFallback: gen.usedFallback,
    usage: gen.usage,
    promptTokensEstimate,
  };
}

// Same threshold, prompt and citation rules as answerQuestion. onSources(usedHits) fires once,
// after the prompt is built and before any token (usedHits carry the [n] numbers).
// onToken receives raw deltas; the returned answer is the cleaned text.
export async function answerQuestionStream(
  {
    question,
    hits,
    history = [],
    signal,
    onSources = () => {},
    onToken = () => {},
  },
  options,
) {
  if (
    !Array.isArray(hits) ||
    hits.length === 0 ||
    Math.max(...hits.map((h) => h.score)) < config.SEARCH_MIN_SCORE
  )
    return { ...NOT_FOUND, sources: [] }; // no LLM call

  const { messages, usedHits, promptTokensEstimate } = buildMessages({
    question,
    hits,
    history,
  });
  if (usedHits.length === 0) return { ...NOT_FOUND, sources: [] };

  onSources(usedHits);
  const gen = await generateStream({ messages, signal, onToken }, options);
  const { cited, text } = extractCitations(gen.text, usedHits.length);
  return {
    notFound: false,
    answer: text,
    sources: usedHits.map((h) => ({ ...h, cited: cited.includes(h.n) })),
    model: gen.model,
    usedFallback: gen.usedFallback,
    usage: gen.usage,
    promptTokensEstimate,
  };
}
