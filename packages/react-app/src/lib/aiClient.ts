// AI drafting client for mcp-jira bridge AI endpoints — CONTRACTS.md §4.9 v1.1
// Same envelope/unwrap/error semantics as mcpClient (incl. BRIDGE_DOWN).
// AI_UNAVAILABLE (503) throws McpError with code "AI_UNAVAILABLE" so callers
// can branch to the deterministic fallback.

import { type McpError } from "./mcpClient";
import type {
  AiStatus,
  DraftRequest,
  DraftResponse,
  EnhanceRequest,
  EnhanceResponse,
  SprintSummaryRequest,
  SprintSummaryResponse,
  PlanDevTicketsRequest,
  PlanDevTicketsResponse,
  AskRequest,
  AskResponse,
} from "./types";

/** HTTP bridge base URL — same as mcpClient jira base */
const JIRA_BASE =
  (import.meta.env.VITE_MCP_JIRA_URL as string | undefined) ??
  "http://localhost:4001";

/** Bridge-down error message, consistent with mcpClient */
function bridgeDownError(): McpError {
  return {
    code: "BRIDGE_DOWN",
    message: "Cannot reach jira bridge — run: npm run dev:jira:http",
  };
}

/**
 * Generic POST to a mcp-jira AI endpoint.
 * Unwraps the { ok, data } envelope.
 * Throws McpError on network failure (BRIDGE_DOWN) or ok: false.
 */
async function postAi<T>(path: string, body: unknown): Promise<T> {
  const url = `${JIRA_BASE}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // Network failure — bridge not running
    throw bridgeDownError();
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    const err: McpError = {
      code: "INTERNAL",
      message: `Bridge returned non-JSON response (status ${response.status})`,
    };
    throw err;
  }

  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "ok" in parsed
  ) {
    const envelope = parsed as {
      ok: boolean;
      data?: T;
      error?: { code: string; message: string; issues?: unknown[] };
    };

    if (envelope.ok && "data" in envelope) {
      return envelope.data as T;
    }

    if (envelope.error) {
      const err: McpError = {
        code: envelope.error.code,
        message: envelope.error.message,
        issues: envelope.error.issues,
      };
      throw err;
    }
  }

  const err: McpError = {
    code: "INTERNAL",
    message: "Unexpected response shape from AI endpoint",
  };
  throw err;
}

/**
 * Fetch AI status from GET /api/health → .ai field.
 * If the field is absent, the fetch fails (bridge down), or any other error occurs,
 * returns { enabled: false, provider: null, model: null } — health failure must NOT crash the page.
 *
 * CONTRACTS.md §2, §4.9 v1.1
 */
export async function getAiStatus(): Promise<AiStatus> {
  const url = `${JIRA_BASE}/api/health`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return { enabled: false, provider: null, model: null };
    }
    const body = await response.json() as Record<string, unknown>;
    const ai = body.ai as AiStatus | undefined;
    if (!ai || typeof ai.enabled !== "boolean") {
      return { enabled: false, provider: null, model: null };
    }
    return {
      enabled: ai.enabled,
      provider: (ai.provider as string | null) ?? null,
      model: (ai.model as string | null) ?? null,
    };
  } catch {
    // Any fetch or parse failure → disabled (safe default)
    return { enabled: false, provider: null, model: null };
  }
}

/**
 * POST /api/ai/draft-tickets — AI-powered ticket pair drafting.
 * Throws McpError. AI_UNAVAILABLE (503) throws McpError{ code: "AI_UNAVAILABLE" }.
 *
 * CONTRACTS.md §4.9
 */
export async function aiDraftTickets(body: DraftRequest): Promise<DraftResponse> {
  return postAi<DraftResponse>("/api/ai/draft-tickets", body);
}

/**
 * POST /api/ai/enhance-ticket — AI-powered ticket enhancement.
 * Throws McpError. AI_UNAVAILABLE (503) throws McpError{ code: "AI_UNAVAILABLE" }.
 *
 * CONTRACTS.md §4.9
 */
export async function aiEnhanceTicket(body: EnhanceRequest): Promise<EnhanceResponse> {
  return postAi<EnhanceResponse>("/api/ai/enhance-ticket", body);
}

/**
 * POST /api/ai/sprint-summary — AI executive summary of a sprint report.
 * Throws McpError. AI_UNAVAILABLE (503) throws McpError{ code: "AI_UNAVAILABLE" }.
 * AI errors must NOT break the data report — callers handle them gracefully.
 *
 * CONTRACTS.md §4.9 v1.4, ADR-012
 */
export async function aiSprintSummary(
  body: SprintSummaryRequest
): Promise<SprintSummaryResponse> {
  return postAi<SprintSummaryResponse>("/api/ai/sprint-summary", body);
}

/**
 * POST /api/ai/plan-dev-tickets — bulk plan: one Dev draft per PO story (v1.11, ADR-022).
 * Throws McpError. AI_UNAVAILABLE (503) throws McpError{ code: "AI_UNAVAILABLE" } so the
 * Linking page can fall back to deterministic templates.
 */
export async function aiPlanDevTickets(
  body: PlanDevTicketsRequest
): Promise<PlanDevTicketsResponse> {
  return postAi<PlanDevTicketsResponse>("/api/ai/plan-dev-tickets", body);
}

/**
 * POST /api/ai/ask — in-app AI Q&A assistant (v1.18, ADR-029).
 * Free-form question answered by an agentic loop over read-only tools.
 * Throws McpError. AI_UNAVAILABLE (503) throws McpError{ code: "AI_UNAVAILABLE" }.
 */
export async function aiAsk(body: AskRequest): Promise<AskResponse> {
  return postAi<AskResponse>("/api/ai/ask", body);
}
