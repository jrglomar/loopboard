/**
 * get_assignable_users tool (v1.7, ADR-018).
 *
 * Lists developers who can be assigned tickets on a project/board.
 * Resolves the Jira project key from an explicit projectKey, or from boardId
 * matching the PO/Dev board IDs in config, defaulting to JIRA_DEV_PROJECT_KEY.
 * Returns only active users, sorted by displayName.
 */

import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import { getConfig } from "../lib/config.js";
import { getAssignableUsers } from "../lib/jiraClient.js";
import type { AssignableUser } from "../lib/types.js";

const schema = z.object({
  projectKey: z.string().optional(),
  boardId: z.number().int().positive().optional(),
  maxResults: z.number().int().min(1).default(50).optional(),
});

interface GetAssignableUsersOutput {
  projectKey: string;
  users: AssignableUser[];
}

async function handler(input: unknown): Promise<GetAssignableUsersOutput> {
  const args = schema.parse(input);
  const cfg = getConfig();

  // Resolve projectKey: explicit wins; else match boardId to PO/Dev; else default DEV
  let resolvedKey: string;
  if (args.projectKey !== undefined && args.projectKey !== "") {
    resolvedKey = args.projectKey;
  } else if (args.boardId !== undefined) {
    const poBoardId = parseInt(cfg.JIRA_PO_BOARD_ID, 10);
    const devBoardId = parseInt(cfg.JIRA_DEV_BOARD_ID, 10);
    if (args.boardId === poBoardId) {
      resolvedKey = cfg.JIRA_PO_PROJECT_KEY;
    } else if (args.boardId === devBoardId) {
      resolvedKey = cfg.JIRA_DEV_PROJECT_KEY;
    } else {
      resolvedKey = cfg.JIRA_DEV_PROJECT_KEY;
    }
  } else {
    resolvedKey = cfg.JIRA_DEV_PROJECT_KEY;
  }

  const maxResults = args.maxResults ?? 50;
  const allUsers = await getAssignableUsers(resolvedKey, maxResults);

  // Keep only active users, sorted by displayName (locale-aware)
  const users = allUsers
    .filter((u) => u.active === true)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  return { projectKey: resolvedKey, users };
}

export const getAssignableUsersTool: ToolDef = {
  name: "get_assignable_users",
  description:
    "List developers who can be assigned tickets on the project/board. " +
    "Accepts an explicit projectKey, or resolves from boardId (PO/Dev board) — defaults to the Dev project. " +
    "Returns only active users, sorted by displayName, each with accountId required by assign_issue.",
  schema,
  handler,
};
