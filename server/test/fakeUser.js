// In-memory stand-in for the Mongoose User model. Implements only what
// routes/auth.js and middleware/auth.js call.
const users = [];
let counter = 0;

export function resetUsers() {
  users.length = 0;
  counter = 0;
}

export const fakeUser = {
  async create({ email, passwordHash }) {
    if (users.some((u) => u.email === email)) {
      const err = new Error("E11000 duplicate key");
      err.code = 11000;
      throw err;
    }
    const user = {
      _id: String(++counter).padStart(24, "0"),
      email,
      passwordHash,
      // Mirrors the real schema's toJSON: never expose the hash.
      toJSON() {
        return { id: String(this._id), email: this.email };
      },
    };
    users.push(user);
    return user;
  },

  // Real code does User.findOne({ email }).select("+passwordHash")
  findOne({ email }) {
    const found = users.find((u) => u.email === email) ?? null;
    return { select: async () => found };
  },

  async findById(id) {
    return users.find((u) => String(u._id) === String(id)) ?? null;
  },
};
