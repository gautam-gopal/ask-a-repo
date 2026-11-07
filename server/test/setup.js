import { vi, beforeEach } from "vitest";
import { resetUsers } from "./fakeUser.js";
import { resetUsageDocs } from "./fakeUsage.js";

// Applies to every test file: the real User model (and mongoose) is never loaded.
vi.mock("../src/models/User.js", async () => {
  const { fakeUser } = await import("./fakeUser.js");
  return { User: fakeUser };
});

vi.mock("../src/models/Message.js", async () => {
  const { fakeMessage } = await import("./fakeIngestModels.js");
  return { Message: fakeMessage };
});

vi.mock("../src/models/Usage.js", async () => {
  const { fakeUsageModel } = await import("./fakeUsage.js");
  return { Usage: fakeUsageModel };
});

beforeEach(() => {
  resetUsers();
  resetUsageDocs();
});
