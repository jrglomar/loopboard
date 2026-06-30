// Leaves client — CONTRACTS.md §4.14, §6, ADR-016 (typed v1.26, ADR-038).
// Wraps get_leaves / set_leaves MCP tools via the HTTP bridge.

import { callTool } from "./mcpClient";
import type { AssigneeLeaves, LeaveType } from "./types";

/** The per-sprint leaves map: assignee display name → (YYYY-MM-DD → LeaveType). */
export type LeavesMap = Record<string, AssigneeLeaves>;

/** A typed leave entry as sent to set_leaves. */
export type LeaveEntry = { date: string; type: LeaveType };

/** Fetch the typed leaves map for a sprint. {} when none recorded. */
export async function getLeaves(sprintId: number): Promise<LeavesMap> {
  const result = await callTool<{ sprintId: number; leaves: LeavesMap }>(
    "jira",
    "get_leaves",
    { sprintId }
  );
  return result.leaves;
}

/** The whole store keyed by sprint id (string) → assignee → date → type. */
export type AllLeavesMap = Record<string, LeavesMap>;

/** Fetch EVERY sprint's typed leaves in one read (v1.29, ADR-041). {} when none. */
export async function getAllLeaves(): Promise<AllLeavesMap> {
  const result = await callTool<{ leaves: AllLeavesMap }>("jira", "get_all_leaves", {});
  return result.leaves;
}

/**
 * Replace an assignee's typed leave entries for a sprint (full replace).
 * Pass [] to clear. Returns the updated full leaves map for the sprint.
 */
export async function setLeaves(
  sprintId: number,
  assignee: string,
  entries: LeaveEntry[]
): Promise<LeavesMap> {
  const result = await callTool<{ sprintId: number; leaves: LeavesMap }>(
    "jira",
    "set_leaves",
    { sprintId, assignee, entries }
  );
  return result.leaves;
}
