// Lazy, cached config loader — per CONTRACTS.md §3
// No env reads at import time. dotenv loaded on first getConfig() call.

import { z } from "zod";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";
import { ConfigError } from "./errors.js";

const configSchema = z.object({
  GITHUB_TOKEN: z.string().min(1, "GITHUB_TOKEN is required"),
  JIRA_BASE_URL: z.string().min(1, "JIRA_BASE_URL is required"),
  JIRA_EMAIL: z.string().min(1, "JIRA_EMAIL is required"),
  JIRA_API_TOKEN: z.string().min(1, "JIRA_API_TOKEN is required"),
  // Optional
  GITHUB_REPO: z.string().optional(),
  JIRA_PO_PROJECT_KEY: z.string().default("PO"),
  JIRA_DEV_PROJECT_KEY: z.string().default("DEV"),
  MCP_GITHUB_HTTP_PORT: z
    .string()
    .default("4002")
    .transform((v) => parseInt(v, 10)),
});

export type Config = z.infer<typeof configSchema>;

let _cache: Config | null = null;

function loadDotenvSync(): void {
  // In vitest, tests manage process.env directly — skip dotenv so developer
  // .env files can't leak into hermetic test assertions (same guard as mcp-jira).
  if (process.env["VITEST"] === "true") return;
  try {
    const _require = createRequire(import.meta.url);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dotenv = _require("dotenv") as { config: (opts: { path: string }) => void };
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    // package-local .env wins (dotenv never overrides already-set process.env vars)
    dotenv.config({ path: path.resolve(__dirname, "../../.env") });
    // repo-root .env fills the gaps
    dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });
  } catch {
    // .env files may not exist — not an error
  }
}

export function getConfig(): Config {
  if (_cache !== null) return _cache;

  loadDotenvSync();

  const result = configSchema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues
      .map((i) => {
        const key = i.path[0];
        return typeof key === "string" ? key : String(key);
      })
      .filter((v, idx, arr) => arr.indexOf(v) === idx)
      .join(", ");
    throw new ConfigError(`Missing or invalid configuration: ${missing}`);
  }

  _cache = result.data;
  return _cache;
}

export function resetConfigCache(): void {
  _cache = null;
}
