import { assertNeurons, assertLlm } from "../services/usage.js";

// Refuse before any paid/free-quota work starts. Reading history and listing repos never use these.
export const ingestBudget = async (_req, _res, next) => {
  await assertNeurons(); // exhausted today? (the exact size check happens inside runIngest)
  next();
};
export const searchBudget = async (_req, _res, next) => {
  await assertNeurons();
  next();
};
export const askBudget = async (_req, _res, next) => {
  await assertNeurons();
  await assertLlm();
  next();
};
