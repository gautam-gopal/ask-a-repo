import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";

// .env lives in the repo root. On Render there is no file; real env vars are used.
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, "../../.env"), quiet: true });

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
