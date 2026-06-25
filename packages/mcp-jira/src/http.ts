/**
 * Jira MCP HTTP bridge — Express adapter for the React dashboard.
 *
 * Exposes the same transport-agnostic tool registry as the stdio entry
 * via HTTP on port MCP_JIRA_HTTP_PORT (default 4001).
 *
 * Also exposes AI drafting endpoints (§4.9) that are NOT in the tool registry.
 *
 * CORS: allows http://localhost:5173 and http://127.0.0.1:5173.
 *
 * Design note: getConfig() is NOT called at module-import time so that
 * this module can be imported in tests that set process.env before calling
 * getConfig(). The only top-level code here is Express middleware registration,
 * which has no side effects on env.
 */

import express from "express";
import cors from "cors";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import * as path from "path";
import { z } from "zod";
import { tools } from "./tools/index.js";
import { getConfig } from "./lib/config.js";
import { UpstreamError, ConfigError } from "./lib/errors.js";
import { ZodError } from "zod";
import { getAiProvider, getAiStatus } from "./lib/ai/provider.js";
import { draftTickets, enhanceTicket, draftSprintSummary, planDevTickets } from "./lib/ai/draftService.js";
import { askAssistant } from "./lib/ai/askService.js";

// ---- Read package version at startup ----
const _require = createRequire(import.meta.url);
const thisDir = path.dirname(fileURLToPath(import.meta.url));
// src/http.ts → ../package.json
const pkgPath = path.resolve(thisDir, "../package.json");
const pkgJson = _require(pkgPath) as { version: string };
const SERVICE_VERSION = pkgJson.version;

// ---- Express app ----

export const app = express();

app.use(express.json());

// CORS allowlist — read from CORS_ORIGINS (comma-separated) at REQUEST time so
// this module stays importable in tests without calling getConfig() at import.
// Default preserves the original dev origins. "*" allows any origin (use behind
// a trusted proxy only). Requests with no Origin header (server-to-server, same
// -origin, curl) are always allowed.
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
  })
);

// ---- Error envelope helper ----

interface ErrorEnvelope {
  ok: false;
  error: {
    code: string;
    message: string;
    issues?: unknown[];
  };
}

function errorResponse(
  res: express.Response,
  status: number,
  code: string,
  message: string,
  issues?: unknown[]
): void {
  const body: ErrorEnvelope = { ok: false, error: { code, message } };
  if (issues !== undefined) body.error.issues = issues;
  res.status(status).json(body);
}

// ---- Input zod schemas for AI endpoints (v3 zod — same as rest of codebase) ----

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(4000),
});

const draftTicketsInputSchema = z
  .object({
    messages: z.array(messageSchema).min(1),
    storyPoints: z.number().int().nonnegative().optional(),
  })
  .refine(
    (val) => val.messages[val.messages.length - 1]?.role === "user",
    { message: "Last message must have role 'user'" }
  );

const TICKET_KEY_REGEX = /^[A-Z][A-Z0-9]{1,9}-\d+$/;

const enhanceTicketInputSchema = z.object({
  ticketKey: z
    .string()
    .regex(TICKET_KEY_REGEX, "ticketKey must match PROJECT-NUMBER format"),
  notes: z.string().max(2000).optional(),
  current: z.object({
    summary: z.string(),
    description: z.string(),
  }),
});

// ---- Input zod schema for plan-dev-tickets AI endpoint (v1.11, ADR-022) ----

const planDevTicketsInputSchema = z.object({
  poStories: z
    .array(
      z.object({
        key: z.string().min(1),
        summary: z.string().min(1),
        description: z.string().optional(),
      })
    )
    .min(1)
    .max(20),
  instructions: z.string().max(2000).optional(),
});

// ---- Input zod schema for the AI Q&A assistant (v1.18, ADR-029) ----

const askInputSchema = z.object({
  question: z.string().min(1).max(2000),
  boardId: z.number().int().positive().optional(),
  sprintId: z.number().int().positive().optional(),
});

// ---- Input zod schema for sprint-summary AI endpoint (v1.4) ----

const sprintSummaryInputSchema = z.object({
  sprintName: z.string(),
  state: z.string(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  goal: z.string().nullable().optional(),
  committedPoints: z.number(),
  completedPoints: z.number(),
  completedCount: z.number().int(),
  totalCount: z.number().int(),
  carryoverCount: z.number().int(),
  blockedCount: z.number().int(),
  byAssignee: z.array(
    z.object({
      name: z.string(),
      donePoints: z.number(),
      totalPoints: z.number(),
      doneCount: z.number().int(),
      totalCount: z.number().int(),
    })
  ),
});

// ---- AI unavailable message ----
const AI_UNAVAILABLE_MSG =
  "AI drafting is disabled — set AI_PROVIDER=anthropic or github and the matching key (see docs/SETUP.md)";

// ---- Routes ----

// GET /api/health
app.get("/api/health", (_req, res) => {
  const ai = getAiStatus();

  // boards — pure config, no Jira call (v1.6, ADR-017)
  // getConfig() is safe here: if board IDs were missing the server would have
  // already exited at startup. The try/catch is a belt-and-suspenders guard so
  // health never throws (same philosophy as getAiStatus).
  let boards: {
    dev: { id: number; projectKey: string };
    po: { id: number; projectKey: string };
  };
  try {
    const cfg = getConfig();
    boards = {
      dev: {
        id: parseInt(cfg.JIRA_DEV_BOARD_ID, 10),
        projectKey: cfg.JIRA_DEV_PROJECT_KEY,
      },
      po: {
        id: parseInt(cfg.JIRA_PO_BOARD_ID, 10),
        projectKey: cfg.JIRA_PO_PROJECT_KEY,
      },
    };
  } catch {
    // Fallback: return sentinel values rather than crashing health
    boards = {
      dev: { id: NaN, projectKey: "DEV" },
      po: { id: NaN, projectKey: "PO" },
    };
  }

  res.json({
    ok: true,
    service: "mcp-jira",
    version: SERVICE_VERSION,
    ai,
    boards,
  });
});

// GET /api/tools — tool registry only (AI endpoints NOT listed here)
app.get("/api/tools", (_req, res) => {
  res.json({
    ok: true,
    data: tools.map((t) => ({ name: t.name, description: t.description })),
  });
});

// POST /api/tools/:name
app.post("/api/tools/:name", async (req, res) => {
  const toolName = req.params["name"];
  const tool = tools.find((t) => t.name === toolName);

  if (!tool) {
    errorResponse(res, 404, "UNKNOWN_TOOL", `Tool '${toolName}' not found`);
    return;
  }

  try {
    const result = await tool.handler(req.body);
    res.json({ ok: true, data: result });
  } catch (err) {
    if (err instanceof ZodError) {
      errorResponse(res, 400, "VALIDATION", "Input validation failed", err.issues);
      return;
    }
    if (err instanceof ConfigError) {
      errorResponse(res, 500, "CONFIG", err.message);
      return;
    }
    if (err instanceof UpstreamError) {
      errorResponse(res, 502, "UPSTREAM", err.message);
      return;
    }
    const msg = err instanceof Error ? err.message : "Internal server error";
    errorResponse(res, 500, "INTERNAL", msg);
  }
});

// POST /api/ai/draft-tickets
app.post("/api/ai/draft-tickets", async (req, res) => {
  // Parse input
  const parsed = draftTicketsInputSchema.safeParse(req.body);
  if (!parsed.success) {
    errorResponse(res, 400, "VALIDATION", "Input validation failed", parsed.error.issues);
    return;
  }

  // Resolve provider
  let provider;
  try {
    provider = await getAiProvider();
  } catch (err) {
    if (err instanceof ConfigError) {
      errorResponse(res, 500, "CONFIG", err.message);
      return;
    }
    const msg = err instanceof Error ? err.message : "Internal server error";
    errorResponse(res, 500, "INTERNAL", msg);
    return;
  }

  if (provider === null) {
    errorResponse(res, 503, "AI_UNAVAILABLE", AI_UNAVAILABLE_MSG);
    return;
  }

  // Call service
  try {
    const result = await draftTickets(
      provider,
      parsed.data.messages,
      parsed.data.storyPoints
    );
    res.json({ ok: true, data: result });
  } catch (err) {
    if (err instanceof UpstreamError) {
      errorResponse(res, 502, "UPSTREAM", err.message);
      return;
    }
    if (err instanceof ConfigError) {
      errorResponse(res, 500, "CONFIG", err.message);
      return;
    }
    const msg = err instanceof Error ? err.message : "Internal server error";
    errorResponse(res, 500, "INTERNAL", msg);
  }
});

// POST /api/ai/enhance-ticket
app.post("/api/ai/enhance-ticket", async (req, res) => {
  // Parse input
  const parsed = enhanceTicketInputSchema.safeParse(req.body);
  if (!parsed.success) {
    errorResponse(res, 400, "VALIDATION", "Input validation failed", parsed.error.issues);
    return;
  }

  // Resolve provider
  let provider;
  try {
    provider = await getAiProvider();
  } catch (err) {
    if (err instanceof ConfigError) {
      errorResponse(res, 500, "CONFIG", err.message);
      return;
    }
    const msg = err instanceof Error ? err.message : "Internal server error";
    errorResponse(res, 500, "INTERNAL", msg);
    return;
  }

  if (provider === null) {
    errorResponse(res, 503, "AI_UNAVAILABLE", AI_UNAVAILABLE_MSG);
    return;
  }

  // Call service
  try {
    const result = await enhanceTicket(
      provider,
      parsed.data.ticketKey,
      parsed.data.notes,
      parsed.data.current
    );
    res.json({ ok: true, data: result });
  } catch (err) {
    if (err instanceof UpstreamError) {
      errorResponse(res, 502, "UPSTREAM", err.message);
      return;
    }
    if (err instanceof ConfigError) {
      errorResponse(res, 500, "CONFIG", err.message);
      return;
    }
    const msg = err instanceof Error ? err.message : "Internal server error";
    errorResponse(res, 500, "INTERNAL", msg);
  }
});

// POST /api/ai/sprint-summary (v1.4, §4.9)
app.post("/api/ai/sprint-summary", async (req, res) => {
  // Parse input
  const parsed = sprintSummaryInputSchema.safeParse(req.body);
  if (!parsed.success) {
    errorResponse(res, 400, "VALIDATION", "Input validation failed", parsed.error.issues);
    return;
  }

  // Resolve provider
  let provider;
  try {
    provider = await getAiProvider();
  } catch (err) {
    if (err instanceof ConfigError) {
      errorResponse(res, 500, "CONFIG", err.message);
      return;
    }
    const msg = err instanceof Error ? err.message : "Internal server error";
    errorResponse(res, 500, "INTERNAL", msg);
    return;
  }

  if (provider === null) {
    errorResponse(res, 503, "AI_UNAVAILABLE", AI_UNAVAILABLE_MSG);
    return;
  }

  // Call service
  try {
    const result = await draftSprintSummary(provider, parsed.data);
    res.json({ ok: true, data: result });
  } catch (err) {
    if (err instanceof UpstreamError) {
      errorResponse(res, 502, "UPSTREAM", err.message);
      return;
    }
    if (err instanceof ConfigError) {
      errorResponse(res, 500, "CONFIG", err.message);
      return;
    }
    const msg = err instanceof Error ? err.message : "Internal server error";
    errorResponse(res, 500, "INTERNAL", msg);
  }
});

// POST /api/ai/plan-dev-tickets (v1.11, §4.9, ADR-022)
app.post("/api/ai/plan-dev-tickets", async (req, res) => {
  const parsed = planDevTicketsInputSchema.safeParse(req.body);
  if (!parsed.success) {
    errorResponse(res, 400, "VALIDATION", "Input validation failed", parsed.error.issues);
    return;
  }

  // Resolve provider
  let provider;
  try {
    provider = await getAiProvider();
  } catch (err) {
    if (err instanceof ConfigError) {
      errorResponse(res, 500, "CONFIG", err.message);
      return;
    }
    const msg = err instanceof Error ? err.message : "Internal server error";
    errorResponse(res, 500, "INTERNAL", msg);
    return;
  }

  if (provider === null) {
    errorResponse(res, 503, "AI_UNAVAILABLE", AI_UNAVAILABLE_MSG);
    return;
  }

  // Call service
  try {
    const result = await planDevTickets(
      provider,
      parsed.data.poStories,
      parsed.data.instructions
    );
    res.json({ ok: true, data: result });
  } catch (err) {
    if (err instanceof UpstreamError) {
      errorResponse(res, 502, "UPSTREAM", err.message);
      return;
    }
    if (err instanceof ConfigError) {
      errorResponse(res, 500, "CONFIG", err.message);
      return;
    }
    const msg = err instanceof Error ? err.message : "Internal server error";
    errorResponse(res, 500, "INTERNAL", msg);
  }
});

// POST /api/ai/ask (v1.18, §4.9, ADR-029) — in-app AI Q&A assistant (read-only tool calls)
app.post("/api/ai/ask", async (req, res) => {
  const parsed = askInputSchema.safeParse(req.body);
  if (!parsed.success) {
    errorResponse(res, 400, "VALIDATION", "Input validation failed", parsed.error.issues);
    return;
  }

  let provider;
  try {
    provider = await getAiProvider();
  } catch (err) {
    if (err instanceof ConfigError) {
      errorResponse(res, 500, "CONFIG", err.message);
      return;
    }
    const msg = err instanceof Error ? err.message : "Internal server error";
    errorResponse(res, 500, "INTERNAL", msg);
    return;
  }

  if (provider === null) {
    errorResponse(res, 503, "AI_UNAVAILABLE", AI_UNAVAILABLE_MSG);
    return;
  }

  try {
    const result = await askAssistant(provider, parsed.data.question, {
      boardId: parsed.data.boardId,
      sprintId: parsed.data.sprintId,
      today: new Date().toISOString().slice(0, 10),
    });
    res.json({ ok: true, data: result });
  } catch (err) {
    if (err instanceof UpstreamError) {
      errorResponse(res, 502, "UPSTREAM", err.message);
      return;
    }
    if (err instanceof ConfigError) {
      errorResponse(res, 500, "CONFIG", err.message);
      return;
    }
    const msg = err instanceof Error ? err.message : "Internal server error";
    errorResponse(res, 500, "INTERNAL", msg);
  }
});

// ---- Start server (only when run directly, not when imported for tests) ----

// This block only runs when the file is executed as a script, not when imported.
// We detect this by checking whether import.meta.url matches the main module.
// In practice, tsx/node will set process.argv[1] to the file path.
// We use a sentinel env var (VITEST=true) to skip the listen call during tests.
if (process.env["VITEST"] !== "true") {
  // Validate config at startup — fail fast with clear error
  let port: number;
  try {
    const cfg = getConfig();
    port = cfg.MCP_JIRA_HTTP_PORT;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[mcp-jira] Config error at startup: ${msg}\n`);
    process.exit(1);
  }

  app.listen(port, () => {
    process.stdout.write(
      `mcp-jira HTTP bridge listening on http://localhost:${port}\n`
    );
  });
}
