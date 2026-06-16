/**
 * set_team_members tool (v1.8, ADR-019).
 *
 * Replace a board's curated team roster (add/remove = send the full updated list).
 * Dedupes by accountId; empty array clears the roster.
 * Read-modify-write on JIRA_TEAM_FILE.
 */

import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import type { TeamMember } from "../lib/types.js";
import { getConfig } from "../lib/config.js";
import { readTeams, writeTeams } from "../lib/teamStore.js";

const schema = z.object({
  boardId: z.number().int().positive().optional(),
  members: z.array(
    z.object({
      accountId: z.string().min(1),
      displayName: z.string().min(1),
    })
  ),
});

interface SetTeamMembersOutput {
  boardId: number;
  members: TeamMember[];
}

async function handler(input: unknown): Promise<SetTeamMembersOutput> {
  const args = schema.parse(input);
  const cfg = getConfig();

  const boardId = args.boardId ?? parseInt(cfg.JIRA_DEV_BOARD_ID, 10);
  const boardKey = String(boardId);

  // Dedupe by accountId — last-seen wins when duplicates appear in input
  const seen = new Map<string, TeamMember>();
  for (const m of args.members) {
    seen.set(m.accountId, { accountId: m.accountId, displayName: m.displayName });
  }
  const deduped = [...seen.values()];

  // Read-modify-write
  const data = readTeams();

  if (deduped.length === 0) {
    // Empty list → clear the board's roster
    delete data[boardKey];
  } else {
    data[boardKey] = deduped;
  }

  writeTeams(data);

  // Return sorted by displayName (same as get_team_members)
  const members = [...deduped].sort((a, b) =>
    a.displayName.localeCompare(b.displayName)
  );

  return { boardId, members };
}

export const setTeamMembersTool: ToolDef = {
  name: "set_team_members",
  description:
    "Set (replace) the curated team roster for a board. " +
    "Send the full updated list to add or remove members — this replaces the existing roster. " +
    "Members are deduped by accountId. " +
    "Pass an empty array to clear the roster for the board. " +
    "Returns the updated roster sorted by display name. " +
    "Data is persisted to a local JSON file on the mcp-jira host (JIRA_TEAM_FILE). " +
    "Use get_recent_assignees to discover who has been assigned tickets recently.",
  schema,
  handler,
};
