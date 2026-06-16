// Leaves client — CONTRACTS.md §4.14, §6, ADR-016
// Wraps get_leaves / set_leaves MCP tools via the HTTP bridge.
// Same McpError / BRIDGE_DOWN semantics as mcpClient.ts.

import { callTool } from "./mcpClient";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * The per-sprint leaves map returned by get_leaves / set_leaves.
 * Maps assignee display name → array of YYYY-MM-DD leave date strings.
 */
export type LeavesMap = Record<string, string[]>;

// ── get_leaves ────────────────────────────────────────────────────────────────

/**
 * Fetch the leaves map for a given sprint.
 * Returns {} when no leaves have been recorded yet.
 *
 * CONTRACTS.md §4.14 v1.5
 */
export async function getLeaves(sprintId: number): Promise<LeavesMap> {
  const result = await callTool<{ sprintId: number; leaves: LeavesMap }>(
    "jira",
    "get_leaves",
    { sprintId }
  );
  return result.leaves;
}

// ── set_leaves ────────────────────────────────────────────────────────────────

/**
 * Replace an assignee's leave dates for a sprint.
 * Pass an empty array to clear all leaves for that assignee.
 * Returns the updated full leaves map for the sprint.
 *
 * CONTRACTS.md §4.14 v1.5
 */
export async function setLeaves(
  sprintId: number,
  assignee: string,
  dates: string[]
): Promise<LeavesMap> {
  const result = await callTool<{ sprintId: number; leaves: LeavesMap }>(
    "jira",
    "set_leaves",
    { sprintId, assignee, dates }
  );
  return result.leaves;
}
