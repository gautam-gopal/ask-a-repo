// In-memory stand-in for the Usage model (only findOne().lean() and updateOne with upsert).
const docs = new Map();
const today = () => new Date().toISOString().slice(0, 10);

export const resetUsageDocs = () => docs.clear();
export function setUsage(partial) {
  docs.set(today(), {
    day: today(),
    neurons: 0,
    llmRequests: 0,
    ...docs.get(today()),
    ...partial,
  });
}

export const fakeUsageModel = {
  findOne({ day }) {
    return {
      lean: async () => (docs.has(day) ? structuredClone(docs.get(day)) : null),
    };
  },
  async updateOne({ day }, update, opts) {
    let doc = docs.get(day);
    if (!doc) {
      if (!opts?.upsert) return { matchedCount: 0 };
      doc = { day, neurons: 0, llmRequests: 0, ...update.$setOnInsert };
      docs.set(day, doc);
    }
    for (const [k, v] of Object.entries(update.$inc ?? {}))
      doc[k] = (doc[k] ?? 0) + v;
    return { matchedCount: 1 };
  },
};
