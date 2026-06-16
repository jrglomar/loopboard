// HTTP bridge — per CONTRACTS.md §2
// Express app exposing tool registry for the React dashboard.

import express from "express";
import cors from "cors";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";
import { tools } from "./tools/index.js";
import { getConfig } from "./lib/config.js";
import { UpstreamError, ConfigError, ValidationError } from "./lib/errors.js";

// Read version from own package.json at startup
const _require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkgJson = _require(path.resolve(__dirname, "../package.json")) as {
  version: string;
};
const SERVICE_VERSION = pkgJson.version;

const app = express();

// CORS allowlist — read from CORS_ORIGINS (comma-separated) at REQUEST time.
// Default preserves the original dev origins; "*" allows any origin (trusted
// proxy only). No-Origin requests (server-to-server / same-origin) are allowed.
export function parseCorsOrigins(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === "") {
    return ["http://localhost:5173", "http://127.0.0.1:5173"];
  }
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

app.use(
  cors({
    origin: (origin, callback) => {
      const allow = parseCorsOrigins(process.env["CORS_ORIGINS"]);
      if (!origin || allow.includes("*") || allow.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  }),
);
app.use(express.json());

// ------- Routes -------

// GET /api/health
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "mcp-github", version: SERVICE_VERSION });
});

// GET /api/tools
app.get("/api/tools", (_req, res) => {
  res.json({
    ok: true,
    data: tools.map((t) => ({ name: t.name, description: t.description })),
  });
});

// POST /api/tools/:name
app.post("/api/tools/:name", async (req, res) => {
  const { name } = req.params;
  const tool = tools.find((t) => t.name === name);

  if (!tool) {
    res.status(404).json({
      ok: false,
      error: { code: "UNKNOWN_TOOL", message: `Unknown tool: ${name}` },
    });
    return;
  }

  try {
    const result = await tool.handler(req.body);
    res.json({ ok: true, data: result });
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400).json({
        ok: false,
        error: {
          code: "VALIDATION",
          message: err.message,
          issues: err.issues,
        },
      });
    } else if (err instanceof UpstreamError) {
      res.status(502).json({
        ok: false,
        error: { code: "UPSTREAM", message: err.message },
      });
    } else if (err instanceof ConfigError) {
      res.status(500).json({
        ok: false,
        error: { code: "CONFIG", message: err.message },
      });
    } else {
      res.status(500).json({
        ok: false,
        error: {
          code: "INTERNAL",
          message: err instanceof Error ? err.message : "Internal server error",
        },
      });
    }
  }
});

// ------- Startup -------

// Fail fast on config errors
try {
  getConfig();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const cfg = getConfig();
const PORT = cfg.MCP_GITHUB_HTTP_PORT;

const server = app.listen(PORT, () => {
  console.log(
    `mcp-github HTTP bridge listening on http://localhost:${PORT}`,
  );
});

export { app, server };
