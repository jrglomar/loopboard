/**
 * get_multi_sprint_report tool (v1.59, ADR-071).
 *
 * One aggregated report across a WINDOW of sprints — the data source for the Reports
 * page's "Trends & KPIs" mode (team + per-developer velocity & trend). Follows
 * get_velocity's cheap pattern: pool sprints once, then ONE getSprintIssues(id,
 * maxResults) call per sprint in parallel, reusing reportMath.ts
 * (makeDodPredicate/computeSprintPoints/computeByAssignee) verbatim — byAssignee is
 * free CPU on the same fetched issues. Never fetches changelogs (aging is
 * get_active_sprint-only).
 *
 * Two mutually-exclusive selection modes:
 *  - sprintIds: report exactly these sprints (chronological by startDate).
 *  - pool (default): the get_velocity pool — closed sprints (+ active when
 *    includeActive), latest-first, optional beforeSprintId anchor, sliced to
 *    sprintCount, reversed to chronological order.
 */

import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import type { SprintRef } from "../lib/types.js";
import { getConfig } from "../lib/config.js";
import { getSprintsByState, getSprintMeta, getSprintIssues } from "../lib/jiraClient.js";
import {
  computeSprintPoints,
  computeByAssignee,
  makeDodPredicate,
  aggregateByAssigneeAcrossSprints,
  type AssigneeStats,
  type MultiSprintAssigneeSummary,
} from "../lib/reportMath.js";
import { sortClosedSprintsLatestFirst } from "../lib/sprintSelect.js";

// BASE schema — a plain ZodObject (JSON-Schema generation for the AI read-allowlist
// depends on this). The cross-field rule lives in the refined variant below, applied
// INSIDE the handler only — same pattern as update_ticket / set_leaves.
const schema = z.object({
  boardId: z.number().int().positive().optional(),
  sprintCount: z.number().int().positive().max(26).optional(),
  beforeSprintId: z.number().int().positive().optional(),
  sprintIds: z.array(z.number().int().positive()).min(1).max(26).optional(),
  includeActive: z.boolean().optional().default(false),
  maxResults: z.number().int().positive().optional().default(200),
});

const refinedSchema = schema.refine(
  (a) => !(a.sprintIds && (a.sprintCount !== undefined || a.beforeSprintId !== undefined)),
  { message: "sprintIds is mutually exclusive with sprintCount/beforeSprintId" }
);

interface MultiSprintEntry {
  sprint: SprintRef;
  committedPoints: number;
  completedPoints: number;
  completionRate: number;
  totalCount: number;
  completedCount: number;
  carryoverCount: number;
  blockedCount: number;
  byAssignee: AssigneeStats[];
}

interface GetMultiSprintReportOutput {
  boardId: number;
  sprintCount: number;
  sprints: MultiSprintEntry[];
  totals: { committedPoints: number; completedPoints: number };
  averageCompleted: number;
  averageCompletionRate: number;
  byAssignee: MultiSprintAssigneeSummary[];
}

/** Map a raw sprint-like object (getSprintsByState / getSprintMeta shape) to a SprintRef. */
function toSprintRef(
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

async function handler(input: unknown): Promise<GetMultiSprintReportOutput> {
  const args = refinedSchema.parse(input);
  const cfg = getConfig();

  const boardId = args.boardId ?? parseInt(cfg.JIRA_DEV_BOARD_ID, 10);
  const isDone = makeDodPredicate(cfg.JIRA_CODE_REVIEW_STATUSES);

  let chronological: SprintRef[];

  if (args.sprintIds) {
    // Explicit path: report exactly these sprints, chronological by startDate.
    const metas = await Promise.all(args.sprintIds.map(getSprintMeta));
    const refs = metas.map((meta) => toSprintRef(meta, meta.boardId));

    // Sort chronologically by startDate ASC (nulls last, tie ascending id) —
    // mirrors sprintSelect.ts's sortSprintsEarliestFirst.
    chronological = [...refs].sort((a, b) => {
      const aDate = a.startDate;
      const bDate = b.startDate;
      if (aDate === null && bDate === null) return a.id - b.id;
      if (aDate === null) return 1;
      if (bDate === null) return -1;
      if (aDate < bDate) return -1;
      if (aDate > bDate) return 1;
      return a.id - b.id;
    });
  } else {
    // Pool path: the get_velocity pool — closed (+ active when includeActive),
    // latest-first, optional beforeSprintId anchor, sliced to sprintCount.
    const sprintCount = args.sprintCount ?? 10;

    const rawClosed = await getSprintsByState(boardId, "closed");
    const rawActive = args.includeActive ? await getSprintsByState(boardId, "active") : [];
    const pool = sortClosedSprintsLatestFirst([...rawClosed, ...rawActive]);

    // v1.5 (ADR-015) beforeSprintId anchor — copied from getVelocity.ts verbatim.
    let candidatePool = pool;
    if (args.beforeSprintId !== undefined) {
      // Fetch the selected sprint's meta to get its startDate/completeDate anchor.
      const selectedMeta = await getSprintMeta(args.beforeSprintId);
      // The anchor date is selectedMeta.startDate, fallback selectedMeta.completeDate.
      const anchorDate = selectedMeta.startDate ?? selectedMeta.completeDate;

      candidatePool = pool.filter((s) => {
        // Exclude the selected sprint itself.
        if (s.id === args.beforeSprintId) return false;

        // A closed sprint's "date" is completeDate, fallback startDate.
        const sprintDate = s.completeDate ?? s.startDate;

        // If no anchor date, conservatively exclude.
        if (anchorDate === null) return false;
        // If the sprint has no date, conservatively exclude.
        if (sprintDate === null) return false;

        // Keep only sprints whose date is strictly before the anchor.
        return sprintDate < anchorDate;
      });
    }

    const selected = candidatePool.slice(0, sprintCount);
    const refs = selected.map((s) => toSprintRef(s, boardId));

    // Reverse to chronological order (oldest→newest).
    chronological = [...refs].reverse();
  }

  if (chronological.length === 0) {
    return {
      boardId,
      sprintCount: 0,
      sprints: [],
      totals: { committedPoints: 0, completedPoints: 0 },
      averageCompleted: 0,
      averageCompletionRate: 0,
      byAssignee: [],
    };
  }

  // One getSprintIssues call per sprint, in parallel — byAssignee/counts are free
  // CPU on the same fetched issues (no extra Jira calls, never fetches changelogs).
  const entries: MultiSprintEntry[] = await Promise.all(
    chronological.map(async (sprint) => {
      const issues = await getSprintIssues(sprint.id, args.maxResults);
      const { committedPoints, completedPoints, completionRate } = computeSprintPoints(
        issues,
        isDone
      );
      const totalCount = issues.length;
      const completedCount = issues.filter(isDone).length;
      const carryoverCount = totalCount - completedCount;
      const blockedCount = issues.filter((i) => i.blocked).length;
      const byAssignee = computeByAssignee(issues, isDone);

      return {
        sprint,
        committedPoints,
        completedPoints,
        completionRate,
        totalCount,
        completedCount,
        carryoverCount,
        blockedCount,
        byAssignee,
      };
    })
  );

  const totals = entries.reduce(
    (acc, e) => ({
      committedPoints: acc.committedPoints + e.committedPoints,
      completedPoints: acc.completedPoints + e.completedPoints,
    }),
    { committedPoints: 0, completedPoints: 0 }
  );
  const averageCompleted = totals.completedPoints / entries.length;
  const averageCompletionRate =
    entries.reduce((sum, e) => sum + e.completionRate, 0) / entries.length;
  const byAssignee = aggregateByAssigneeAcrossSprints(
    entries.map((e) => e.byAssignee),
    entries.length
  );

  return {
    boardId,
    sprintCount: entries.length,
    sprints: entries,
    totals,
    averageCompleted,
    averageCompletionRate,
    byAssignee,
  };
}

export const getMultiSprintReportTool: ToolDef = {
  name: "get_multi_sprint_report",
  description:
    "Get ONE aggregated report across a WINDOW of sprints — the data behind trends and KPIs. " +
    "Default: the last 10 closed sprints on the board. Pass sprintCount (1-26) to change the " +
    "window size, includeActive=true to also pool active sprints, beforeSprintId to only " +
    "consider sprints before a given sprint, OR sprintIds=[...] to report exactly those sprints " +
    "(mutually exclusive with sprintCount/beforeSprintId). Returns per-sprint committed/completed " +
    "points, completion rate, counts (total/completed/carryover/blocked) and per-assignee stats " +
    "in chronological order, plus window totals, averageCompleted, averageCompletionRate, and a " +
    "cross-sprint per-assignee aggregate (sprintsActive, donePoints, totalPoints, avgDonePoints " +
    "averaged over the FULL window). Completed = done OR code review (DoD). Empty window → zeros, no error.",
  schema,
  handler,
};
