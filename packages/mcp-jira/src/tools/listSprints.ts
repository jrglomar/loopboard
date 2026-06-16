/**
 * list_sprints tool (v1.4, ADR-011).
 *
 * Lists sprints for a board grouped by state (active/future/closed).
 * GET /rest/agile/1.0/board/{boardId}/sprint?state=...
 */

import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import type { SprintRef } from "../lib/types.js";
import { getConfig } from "../lib/config.js";
import { getSprintsByState } from "../lib/jiraClient.js";
import { sortSprintsLatestFirst, sortSprintsEarliestFirst } from "../lib/sprintSelect.js";

const schema = z.object({
  boardId: z.number().int().positive().optional(),
  state: z.enum(["active", "future", "closed", "all"]).default("all"),
  maxResults: z.number().int().positive().default(50),
});

interface ListSprintsOutput {
  boardId: number;
  active: SprintRef[];
  future: SprintRef[];
  closed: SprintRef[];
}

function mapToSprintRef(
  s: {
    id: number;
    name: string;
    state: string;
    startDate: string | null;
    endDate: string | null;
    completeDate: string | null;
    goal: string | null;
  },
  boardId: number
): SprintRef {
  return {
    id: s.id,
    name: s.name,
    state: s.state as "active" | "future" | "closed",
    startDate: s.startDate,
    endDate: s.endDate,
    completeDate: s.completeDate,
    goal: s.goal,
    boardId,
  };
}

async function handler(input: unknown): Promise<ListSprintsOutput> {
  const args = schema.parse(input);
  const cfg = getConfig();

  const boardId = args.boardId ?? parseInt(cfg.JIRA_DEV_BOARD_ID, 10);

  // Determine which Jira state string to request
  const jiraState =
    args.state === "all" ? "active,future,closed" : args.state;

  const rawSprints = await getSprintsByState(boardId, jiraState);

  // Split by state
  const rawActive = rawSprints.filter((s) => s.state === "active");
  const rawFuture = rawSprints.filter((s) => s.state === "future");
  const rawClosed = rawSprints.filter((s) => s.state === "closed");

  // Sort: active latest-first, future earliest-first, closed latest-completed-first
  const sortedActive = sortSprintsLatestFirst(rawActive).map((s) =>
    mapToSprintRef(s, boardId)
  );
  const sortedFuture = sortSprintsEarliestFirst(rawFuture).map((s) =>
    mapToSprintRef(s, boardId)
  );

  // Closed: sort latest-completed-first (by completeDate desc, then endDate desc, then id desc)
  const sortedClosed = [...rawClosed]
    .sort((a, b) => {
      const aDate = a.completeDate ?? a.endDate;
      const bDate = b.completeDate ?? b.endDate;
      if (aDate === null && bDate === null) return b.id - a.id;
      if (aDate === null) return 1;
      if (bDate === null) return -1;
      if (aDate > bDate) return -1;
      if (aDate < bDate) return 1;
      return b.id - a.id;
    })
    .map((s) => mapToSprintRef(s, boardId));

  return {
    boardId,
    active: sortedActive,
    future: sortedFuture,
    closed: sortedClosed,
  };
}

export const listSprintsTool: ToolDef = {
  name: "list_sprints",
  description:
    "List sprints for a Jira board grouped by state: active (latest-first), future (next-up first), " +
    "and closed (latest-completed first). " +
    "Use state='active' | 'future' | 'closed' to filter; default 'all' returns all three groups. " +
    "Useful for populating sprint pickers, target-sprint dropdowns, and the reports page.",
  schema,
  handler,
};
