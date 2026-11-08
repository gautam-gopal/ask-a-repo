// In-memory stand-in for the Mongoose User model. Implements only what
// routes/auth.js and middleware/auth.js call.
const users = [];
let counter = 0;

export function resetUsers() {
  users.length = 0;
  counter = 0;
}

export const fakeUser = {
  async create({ email, passwordHash, isDemo = false }) {
    if (users.some((u) => u.email === email)) {
      const err = new Error("E11000 duplicate key");
      err.code = 11000;
      throw err;
    }
    const user = {
      _id: String(++counter).padStart(24, "0"),
      email,
      passwordHash,
      isDemo,
      // Mirrors the real schema's toJSON: never expose the hash or the flag.
      toJSON() {
        return { id: String(this._id), email: this.email };
      },
    };
    users.push(user);
    return user;
  },

  async estimatedDocumentCount() {
    return users.length;
  },

  // Awaitable (User.findOne({ isDemo: true })) and chainable (.select(...)).
  findOne(filter) {
    const found =
      users.find((u) => Object.entries(filter).every(([k, v]) => u[k] === v)) ??
      null;
    return {
      select: async () => found,
      then: (resolve, reject) => Promise.resolve(found).then(resolve, reject),
    };
  },

  async findById(id) {
    return users.find((u) => String(u._id) === String(id)) ?? null;
  },
};
