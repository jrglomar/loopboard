// teamClient.ts — CONTRACTS.md §4.16 v1.8, ADR-019
// Wraps get_team_members / set_team_members / get_recent_assignees MCP tools
// via the HTTP bridge.
// Same McpError / BRIDGE_DOWN semantics as mcpClient.ts.

import { callTool } from "./mcpClient";
import type { TeamMember, RecentAssignee } from "./types";

// ── get_team_members ──────────────────────────────────────────────────────────

/**
 * Fetch the curated team roster for the given board.
 * Returns [] when no roster has been saved yet.
 * Sorted by displayName.
 *
 * CONTRACTS.md §4.16 v1.8
 */
export async function getTeamMembers(boardId?: number): Promise<TeamMember[]> {
  const result = await callTool<{ boardId: number; members: TeamMember[] }>(
    "jira",
    "get_team_members",
    boardId !== undefined ? { boardId } : {}
  );
  return result.members;
}

// ── set_team_members ──────────────────────────────────────────────────────────

/**
 * Replace the team roster for the given board with the provided list.
 * Full-replace semantics: add/remove = send the full updated list.
 * Deduped by accountId server-side. [] clears the roster.
 * Returns the updated roster, sorted by displayName.
 *
 * CONTRACTS.md §4.16 v1.8
 */
export async function setTeamMembers(
  boardId: number | undefined,
  members: TeamMember[]
): Promise<TeamMember[]> {
  const input: { boardId?: number; members: TeamMember[] } = { members };
  if (boardId !== undefined) input.boardId = boardId;
  const result = await callTool<{ boardId: number; members: TeamMember[] }>(
    "jira",
    "set_team_members",
    input
  );
  return result.members;
}

// ── get_recent_assignees ──────────────────────────────────────────────────────

/**
 * Fetch distinct assignees recently assigned across the WHOLE board (v1.9 — ADR-020:
 * board-wide scan, incl. the active sprint — not just the last few closed sprints).
 * Sorted by ticketCount desc — the "usual members" seed for the team roster.
 *
 * CONTRACTS.md §4.16 v1.9
 */
export async function getRecentAssignees(
  boardId?: number,
  withinDays?: number
): Promise<RecentAssignee[]> {
  const input: { boardId?: number; withinDays?: number } = {};
  if (boardId !== undefined) input.boardId = boardId;
  if (withinDays !== undefined) input.withinDays = withinDays;
  const result = await callTool<{
    boardId: number;
    assignees: RecentAssignee[];
  }>("jira", "get_recent_assignees", input);
  return result.assignees;
}
