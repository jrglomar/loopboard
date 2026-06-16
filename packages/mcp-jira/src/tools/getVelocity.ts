/**
 * get_velocity tool (v1.4, ADR-012; updated v1.5, ADR-015).
 *
 * Averages completed story points over the last N closed sprints,
 * returning chronological data (oldest→newest) plus averageCompleted and forecastNext.
 *
 * v1.5 (ADR-015): optional `beforeSprintId` — when provided, only considers closed
 * sprints that come BEFORE the selected sprint (excludes the sprint itself and any
 * closed sprint whose completeDate/startDate is not earlier than the selected sprint's
 * startDate/completeDate).
 *
 * v1.5 (ADR-014): uses the DoD predicate (done OR code review) for completedPoints.
 *
 * Uses list_sprints (closed, latest-completed-first), takes first N,
 * then runs report point math per sprint.
 */

import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import { getConfig } from "../lib/config.js";
import { getSprintsByState, getSprintIssues, getSprintMeta } from "../lib/jiraClient.js";
import { computeSprintPoints, makeDodPredicate } from "../lib/reportMath.js";

const schema = z.object({
  boardId: z.number().int().positive().optional(),
  sprintCount: z.number().int().positive().optional(),
  beforeSprintId: z.number().int().positive().optional(),
});

interface VelocitySprintEntry {
  id: number;
  name: string;
  committedPoints: number;
  completedPoints: number;
  completeDate: string | null;
}

interface GetVelocityOutput {
  boardId: number;
  sprintCount: number;
  sprints: VelocitySprintEntry[];
  averageCompleted: number;
  forecastNext: number;
}

async function handler(input: unknown): Promise<GetVelocityOutput> {
  const args = schema.parse(input);
  const cfg = getConfig();

  const boardId = args.boardId ?? parseInt(cfg.JIRA_DEV_BOARD_ID, 10);
  const sprintCount = args.sprintCount ?? cfg.JIRA_VELOCITY_SPRINTS;

  // v1.5 (ADR-014): use the DoD predicate (done OR code review).
  const isDone = makeDodPredicate(cfg.JIRA_CODE_REVIEW_STATUSES);

  // Fetch closed sprints
  const rawClosed = await getSprintsByState(boardId, "closed");

  // Sort latest-completed-first (by completeDate fallback startDate)
  const sortedClosed = [...rawClosed].sort((a, b) => {
    const aDate = a.completeDate ?? a.endDate;
    const bDate = b.completeDate ?? b.endDate;
    if (aDate === null && bDate === null) return b.id - a.id;
    if (aDate === null) return 1;
    if (bDate === null) return -1;
    if (aDate > bDate) return -1;
    if (aDate < bDate) return 1;
    return b.id - a.id;
  });

  // v1.5 (ADR-015): when beforeSprintId is provided, filter to only closed sprints
  // that come strictly before the selected sprint.
  let candidateClosed = sortedClosed;
  if (args.beforeSprintId !== undefined) {
    // Fetch the selected sprint's meta to get its startDate/completeDate anchor.
    const selectedMeta = await getSprintMeta(args.beforeSprintId);
    // The anchor date is selectedMeta.startDate, fallback selectedMeta.completeDate.
    const anchorDate = selectedMeta.startDate ?? selectedMeta.completeDate;

    candidateClosed = sortedClosed.filter((s) => {
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

  // Take the first N (most recently completed) from the filtered window
  const selected = candidateClosed.slice(0, sprintCount);

  if (selected.length === 0) {
    return {
      boardId,
      sprintCount,
      sprints: [],
      averageCompleted: 0,
      forecastNext: 0,
    };
  }

  // Fetch issues for each sprint and compute points using the DoD predicate
  const entries: VelocitySprintEntry[] = await Promise.all(
    selected.map(async (sprint) => {
      const issues = await getSprintIssues(sprint.id, 200);
      const { committedPoints, completedPoints } = computeSprintPoints(issues, isDone);
      return {
        id: sprint.id,
        name: sprint.name,
        committedPoints,
        completedPoints,
        completeDate: sprint.completeDate,
      };
    })
  );

  // Reverse to chronological order (oldest→newest)
  const chronological = [...entries].reverse();

  // Average of completedPoints
  const totalCompleted = chronological.reduce(
    (sum, s) => sum + s.completedPoints,
    0
  );
  const averageCompleted =
    chronological.length > 0 ? totalCompleted / chronological.length : 0;

  // Forecast = averageCompleted rounded to ≤2 decimals
  const forecastNext = Math.round(averageCompleted * 100) / 100;

  return {
    boardId,
    sprintCount,
    sprints: chronological,
    averageCompleted,
    forecastNext,
  };
}

export const getVelocityTool: ToolDef = {
  name: "get_velocity",
  description:
    "Get velocity data for a board: averages completed story points (done OR in code review) " +
    "over the last N closed sprints (default JIRA_VELOCITY_SPRINTS = 6). " +
    "Returns sprints in chronological order (oldest→newest) with committedPoints and " +
    "completedPoints per sprint, plus averageCompleted and a heuristic forecastNext — not a commitment. " +
    "Pass beforeSprintId to limit velocity to sprints that come before a specific sprint " +
    "(useful for the Reports page: 'the N sprints prior to the one I am viewing'). " +
    "Empty window → zeros, no error.",
  schema,
  handler,
};
