import { describe, it, expect } from "vitest";
import { config } from "../src/config.js";

describe("Groq model defaults", () => {
  it("use the GPT-OSS models when the env vars are unset", () => {
    expect(config.GROQ_MODEL).toBe("openai/gpt-oss-120b");
    expect(config.GROQ_FALLBACK_MODEL).toBe("openai/gpt-oss-20b");
  });
});
