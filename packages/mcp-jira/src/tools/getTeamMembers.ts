/**
 * get_team_members tool (v1.8, ADR-019).
 *
 * Returns the persisted curated team roster for a board.
 * Missing file or no entry for the board → [] (never errors).
 * Reads from JIRA_TEAM_FILE JSON store (same pattern as leavesStore).
 */

import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import type { TeamMember } from "../lib/types.js";
import { getConfig } from "../lib/config.js";
import { readTeams } from "../lib/teamStore.js";

const schema = z.object({
  boardId: z.number().int().positive().optional(),
});

interface GetTeamMembersOutput {
  boardId: number;
  members: TeamMember[];
}

async function handler(input: unknown): Promise<GetTeamMembersOutput> {
  const args = schema.parse(input);
  const cfg = getConfig();

  const boardId = args.boardId ?? parseInt(cfg.JIRA_DEV_BOARD_ID, 10);
  const boardKey = String(boardId);

  const data = readTeams();
  const raw = data[boardKey] ?? [];

  // Sort by displayName ascending
  const members = [...raw].sort((a, b) =>
    a.displayName.localeCompare(b.displayName)
  );

  return { boardId, members };
}

export const getTeamMembersTool: ToolDef = {
  name: "get_team_members",
  description:
    "Get the curated team roster for a board. " +
    "Returns the persisted list of team members (accountId + displayName). " +
    "Returns an empty array when no roster has been saved for the board yet. " +
    "Members are sorted by display name. " +
    "Use set_team_members to update the roster. " +
    "Data is persisted to a local JSON file on the mcp-jira host (JIRA_TEAM_FILE).",
  schema,
  handler,
};
