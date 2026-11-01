import { defineConfig } from "vitest/config";

// Env vars are set here so config.js passes validation without a .env file.
export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./test/setup.js"],
    env: {
      NODE_ENV: "test",
      MONGODB_URI: "mongodb://localhost:27017/askarepo-test",
      JWT_SECRET: "test-secret-test-secret-test-secret-1234",
      GITHUB_TOKEN: "test-github-token-not-real",
      CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
      CLOUDFLARE_API_TOKEN: "test-cf-token-not-real",
    },
  },
});
