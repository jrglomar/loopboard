/**
 * get_recent_assignees tool (v1.8, ADR-019; board-wide rewrite v1.9, ADR-020).
 *
 * Scans the WHOLE board for recently-assigned issues and returns distinct
 * assignees with their ticket counts — the suggestion source for seeding /
 * refreshing the curated team roster.
 *
 * v1.9 (ADR-020): replaced the "latest N sprints (closed-first)" sampling — which
 * never reached the active sprint and surfaced only ~3-4 people — with a single
 * board-wide JQL scan over recently-updated assigned issues (active sprint +
 * backlog + recent), via getBoardAssigneesRaw.
 */

import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import { getConfig } from "../lib/config.js";
import { getBoardAssigneesRaw } from "../lib/jiraClient.js";

const schema = z.object({
  boardId: z.number().int().positive().optional(),
  /** Look back this many days for "recently assigned" (default 90 ≈ 6 sprints). */
  withinDays: z.number().int().positive().default(90),
  /** Cap on issues scanned (paged 50 at a time). */
  maxResults: z.number().int().positive().default(200),
});

interface RecentAssignee {
  accountId: string;
  displayName: string;
  ticketCount: number;
}

interface GetRecentAssigneesOutput {
  boardId: number;
  assignees: RecentAssignee[];
}

async function handler(input: unknown): Promise<GetRecentAssigneesOutput> {
  const args = schema.parse(input);
  const cfg = getConfig();

  const boardId = args.boardId ?? parseInt(cfg.JIRA_DEV_BOARD_ID, 10);

  // Whole-board scan of recently-assigned issues (covers the active sprint,
  // which the prior sprint-sampling approach missed). ORDER BY updated DESC so
  // the maxResults cap keeps the most recent work.
  const jql =
    `assignee IS NOT EMPTY AND updated >= -${args.withinDays}d ORDER BY updated DESC`;

  const rows = await getBoardAssigneesRaw(boardId, jql, args.maxResults);

  // Collect distinct assignees by accountId, counting tickets per person.
  const countMap = new Map<string, RecentAssignee>();

  for (const row of rows) {
    if (row.assigneeAccountId === null || row.assigneeAccountId === "") {
      // Skip unassigned or missing accountId
      continue;
    }
    const existing = countMap.get(row.assigneeAccountId);
    if (existing !== undefined) {
      existing.ticketCount += 1;
    } else {
      countMap.set(row.assigneeAccountId, {
        accountId: row.assigneeAccountId,
        displayName: row.assignee ?? row.assigneeAccountId,
        ticketCount: 1,
      });
    }
  }

  // Sort by ticketCount desc, then displayName asc (locale)
  const assignees = [...countMap.values()].sort((a, b) => {
    if (b.ticketCount !== a.ticketCount) return b.ticketCount - a.ticketCount;
    return a.displayName.localeCompare(b.displayName);
  });

  return { boardId, assignees };
}

export const getRecentAssigneesTool: ToolDef = {
  name: "get_recent_assignees",
  description:
    "Scan the whole board for recently-assigned issues and return distinct assignees with ticket counts. " +
    "Uses JQL 'assignee IS NOT EMPTY AND updated >= -{withinDays}d' over GET board/{id}/issue (paged), so it " +
    "includes the active sprint + backlog + recent work — not just the last few closed sprints. " +
    "Null assignees are skipped. Returns assignees sorted by ticket count (desc) then display name. " +
    "Use this as the suggestion source for seeding or refreshing the curated team roster (get_team_members / set_team_members).",
  schema,
  handler,
};
