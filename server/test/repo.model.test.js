import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import { Repo, REPO_TTL_MS } from "../src/models/Repo.js";

const base = () => ({
  userId: new mongoose.Types.ObjectId(),
  owner: "Octo",
  name: "Hello",
  ownerLower: "octo",
  nameLower: "hello",
});

describe("Repo model", () => {
  it("non-demo repos get expiresAt about 7 days ahead and status queued", async () => {
    const d = new Repo(base());
    await d.validate();
    const ms = d.expiresAt.getTime() - Date.now();
    expect(ms).toBeGreaterThan(REPO_TTL_MS - 5000);
    expect(ms).toBeLessThanOrEqual(REPO_TTL_MS);
    expect(d.status).toBe("queued");
  });

  it("demo repos have no expiresAt, even if one is supplied", async () => {
    const d = new Repo({ ...base(), isDemo: true, expiresAt: new Date() });
    await d.validate();
    expect(d.expiresAt).toBeUndefined();
  });

  it("declares the unique compound index and the TTL index", () => {
    const idx = Repo.schema.indexes();
    expect(idx).toContainEqual([
      { userId: 1, ownerLower: 1, nameLower: 1 },
      expect.objectContaining({ unique: true }),
    ]);
    expect(idx).toContainEqual([
      { expiresAt: 1 },
      expect.objectContaining({ expireAfterSeconds: 0 }),
    ]);
  });

  it("toJSON hides the lowercase fields and exposes id", () => {
    const json = new Repo(base()).toJSON();
    expect(json.id).toBeDefined();
    expect(json.ownerLower).toBeUndefined();
    expect(json.nameLower).toBeUndefined();
  });
});
