export const repos = [];
export const chunks = [];
export const messages = [];
let counter = 0;
const nextId = () => String(++counter).padStart(24, "0");
const clone = (v) => structuredClone(v);

export function resetIngestModels() {
  repos.length = 0;
  chunks.length = 0;
  messages.length = 0;
  counter = 0;
}

function matches(doc, filter) {
  return Object.entries(filter).every(([key, cond]) => {
    const actual = doc[key];
    if (cond && typeof cond === "object" && "$in" in cond)
      return cond.$in.map(String).includes(String(actual));
    return String(actual) === String(cond);
  });
}

function setPath(obj, path, value) {
  const keys = path.split(".");
  let cur = obj;
  for (const k of keys.slice(0, -1)) cur = cur[k] ??= {};
  cur[keys[keys.length - 1]] = value;
}

// Awaitable like a Mongoose query, with .lean(), .sort({ a: 1, b: -1 }) and .limit(n).
const query = (fn) => {
  let sortSpec = null;
  let limitN = null;
  const run = async () => {
    let out = await fn();
    if (sortSpec && Array.isArray(out)) {
      const keys = Object.entries(sortSpec);
      out.sort((a, b) => {
        for (const [key, dir] of keys) {
          const c = a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0;
          if (c) return c * dir;
        }
        return 0;
      });
    }
    if (limitN !== null && Array.isArray(out)) out = out.slice(0, limitN);
    return out;
  };
  const q = {
    sort(spec) {
      sortSpec = spec;
      return q;
    },
    limit(n) {
      limitN = n;
      return q;
    },
    lean: run,
    then: (resolve, reject) => run().then(resolve, reject),
  };
  return q;
};

export const fakeRepo = {
  async create(data) {
    const dup = repos.some(
      (r) =>
        String(r.userId) === String(data.userId) &&
        r.ownerLower === data.ownerLower &&
        r.nameLower === data.nameLower,
    );
    if (dup) {
      const err = new Error("E11000 duplicate key");
      err.code = 11000;
      throw err;
    }
    const isDemo = data.isDemo ?? false;
    const doc = {
      status: "queued",
      fileCount: 0,
      chunkCount: 0,
      progress: { embedded: 0, total: 0 },
      usage: { estimatedTokens: 0, estimatedNeurons: 0 },
      ...data,
      _id: nextId(),
      isDemo,
      expiresAt: isDemo
        ? undefined
        : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    };
    repos.push(doc);
    return clone(doc);
  },
  findById(id) {
    return query(() => {
      const d = repos.find((r) => String(r._id) === String(id));
      return d ? clone(d) : null;
    });
  },
  findOne(filter) {
    return query(() => {
      const d = repos.find((r) => matches(r, filter));
      return d ? clone(d) : null;
    });
  },
  find(filter) {
    return query(() => repos.filter((r) => matches(r, filter)).map(clone));
  },
  async countDocuments(filter) {
    return repos.filter((r) => matches(r, filter)).length;
  },
  async deleteOne(filter) {
    const i = repos.findIndex((r) => matches(r, filter));
    if (i >= 0) repos.splice(i, 1);
    return { deletedCount: i >= 0 ? 1 : 0 };
  },
  async updateOne(filter, update) {
    const doc = repos.find((r) => matches(r, filter));
    if (!doc) return { matchedCount: 0 };
    for (const [p, v] of Object.entries(update.$set)) setPath(doc, p, v);
    return { matchedCount: 1 };
  },
  async updateMany(filter, update) {
    const docs = repos.filter((r) => matches(r, filter));
    for (const d of docs)
      for (const [p, v] of Object.entries(update.$set)) setPath(d, p, v);
    return { matchedCount: docs.length };
  },
};

export const fakeChunk = {
  async insertMany(docs) {
    for (const d of docs) chunks.push({ ...clone(d), _id: nextId() });
    return docs;
  },
  async deleteMany(filter) {
    let deleted = 0;
    for (let i = chunks.length - 1; i >= 0; i--) {
      if (matches(chunks[i], filter)) {
        chunks.splice(i, 1);
        deleted++;
      }
    }
    return { deletedCount: deleted };
  },
  async countDocuments(filter) {
    return chunks.filter((c) => matches(c, filter)).length;
  },
};

export const fakeMessage = {
  async create(data) {
    const doc = {
      answer: null,
      notFound: false,
      sources: [],
      model: null,
      usedFallback: false,
      createdAt: new Date(),
      ...clone(data),
      _id: nextId(),
    };
    messages.push(doc);
    return clone(doc);
  },
  find(filter) {
    return query(() => messages.filter((m) => matches(m, filter)).map(clone));
  },
  async deleteMany(filter) {
    let deleted = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (matches(messages[i], filter)) {
        messages.splice(i, 1);
        deleted++;
      }
    }
    return { deletedCount: deleted };
  },
};
