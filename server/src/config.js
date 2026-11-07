import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";

// .env lives in the repo root. On Render there is no file; real env vars are used.
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, "../../.env"), quiet: true });

const posInt = (d) => z.coerce.number().int().min(1).default(d);

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  MONGODB_URI: z
    .string()
    .regex(
      /^mongodb(\+srv)?:\/\//,
      "must start with mongodb:// or mongodb+srv://",
    ),
  JWT_SECRET: z.string().min(32, "must be at least 32 characters"),
  GITHUB_TOKEN: z
    .string()
    .min(1, "is required (fine-grained PAT, public repos read-only)"),
  CLOUDFLARE_ACCOUNT_ID: z
    .string()
    .regex(/^[A-Za-z0-9]{1,64}$/, "is required (Cloudflare account id)"),
  CLOUDFLARE_API_TOKEN: z
    .string()
    .min(1, "is required (Workers AI read/run token)"),
  EMBEDDING_MODEL: z
    .string()
    .regex(/^@cf\/[A-Za-z0-9._\/-]+$/, "must look like @cf/vendor/model")
    .default("@cf/baai/bge-base-en-v1.5"),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().min(1).default(768),
  QUERY_PREFIX_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  // Same pattern as above on purpose: z.coerce.boolean() would turn the string "false" into true.
  INDEX_EXCLUDE_TESTS: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  GROQ_API_KEY: z.string().min(1, "is required (Groq API key)"),
  GROQ_MODEL: z
    .string()
    .regex(/^[A-Za-z0-9._\/-]+$/, "must be a model id")
    .default("openai/gpt-oss-120b"),
  GROQ_FALLBACK_MODEL: z
    .string()
    .regex(/^[A-Za-z0-9._\/-]+$/, "must be a model id")
    .default("openai/gpt-oss-20b"),
  // PROVISIONAL 0.795 (D-089): highest 0.005 step that rejected 0 on-topic questions in the
  // `no-tests` eval run. Small sample, tuned on the questions it is scored on.
  SEARCH_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.795),

  // 12A: proxy hops, caps, budgets, rate limits (D-091 to D-097). Defaults are the real limits.
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(1),
  MAX_USERS: posInt(200),
  DAILY_NEURON_BUDGET: posInt(8000), // Cloudflare allowance is 10,000; headroom for the estimate error
  DAILY_LLM_REQUEST_BUDGET: posInt(500), // SET FROM YOUR GROQ DASHBOARD (see note below)
  RL_SIGNUP_MAX: posInt(5),
  RL_LOGIN_MAX: posInt(10),
  RL_ASK_USER_MAX: posInt(20),
  RL_ASK_IP_MAX: posInt(60),
  RL_INGEST_USER_MAX: posInt(5),
  RL_INGEST_IP_MAX: posInt(10),
  RL_GENERAL_MAX: posInt(300),
});

// Treat empty values (e.g. "PORT=") as unset so defaults apply.
const raw = Object.fromEntries(
  Object.entries(process.env).filter(([, v]) => v !== ""),
);
const result = schema.safeParse(raw);

if (!result.success) {
  console.error("Invalid environment configuration:");
  for (const issue of result.error.issues) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  console.error("Fix .env (see .env.example) and restart.");
  process.exit(1);
}

export const config = Object.freeze(result.data);
