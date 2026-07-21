// draftPlanClient.ts — CONTRACTS.md §4.30 v1.70, ADR-081
// Wraps get_draft_plan / set_draft_plan MCP tools via the HTTP bridge.
// DRAFT ONLY — these tools NEVER write to Jira; real assignment remains
// assign_issue (§4.15). Same McpError / BRIDGE_DOWN semantics as mcpClient.ts.

import { callTool } from "./mcpClient";
import type { DraftShare, DraftPlan } from "./types";

// ── get_draft_plan ────────────────────────────────────────────────────────────

/**
 * Fetch the PO sprint's draft capacity plan.
 * No draft saved yet → { sprintId, devSprintId: null, assignments: {} }.
 *
 * CONTRACTS.md §4.30 v1.70
 */
export async function getDraftPlan(sprintId: number): Promise<DraftPlan> {
  return callTool<DraftPlan>("jira", "get_draft_plan", { sprintId });
}

// ── set_draft_plan ────────────────────────────────────────────────────────────

/**
 * Replace the PO sprint's whole draft (full-replace semantics — like every
 * sibling store). Empty assignments with devSprintId null deletes the sprint's
 * entry. An empty share array for a key is invalid server-side — omit the key
 * instead. Returns the updated draft.
 *
 * CONTRACTS.md §4.30 v1.70
 */
export async function setDraftPlan(
  sprintId: number,
  devSprintId: number | null,
  assignments: Record<string, DraftShare[]>
): Promise<DraftPlan> {
  return callTool<DraftPlan>("jira", "set_draft_plan", {
    sprintId,
    devSprintId,
    assignments,
  });
}
