// assignClient.ts — CONTRACTS.md §4.15 v1.7, ADR-018
// Wraps get_assignable_users / assign_issue MCP tools via the HTTP bridge.
// Same McpError / BRIDGE_DOWN semantics as mcpClient.ts.

import { callTool } from "./mcpClient";
import type { AssignableUser } from "./types";

// ── get_assignable_users ──────────────────────────────────────────────────────

export interface GetAssignableUsersOpts {
  projectKey?: string;
  boardId?: number;
}

/**
 * Fetch the active assignable users for a project / board.
 * Returns active-only, sorted by displayName.
 *
 * CONTRACTS.md §4.15 v1.7
 */
export async function getAssignableUsers(
  opts: GetAssignableUsersOpts
): Promise<AssignableUser[]> {
  const result = await callTool<{ projectKey: string; users: AssignableUser[] }>(
    "jira",
    "get_assignable_users",
    opts
  );
  return result.users;
}

// ── assign_issue ──────────────────────────────────────────────────────────────

export interface AssignIssueResult {
  ticketKey: string;
  accountId: string | null;
  assigned: boolean;
}

/**
 * Assign a Jira issue to a user (by accountId) or unassign it (accountId = null).
 * This is a REAL Jira write — use optimistic UI on the caller side.
 *
 * CONTRACTS.md §4.15 v1.7
 */
export async function assignIssue(
  ticketKey: string,
  accountId: string | null
): Promise<AssignIssueResult> {
  return callTool<AssignIssueResult>("jira", "assign_issue", {
    ticketKey,
    accountId,
  });
}
