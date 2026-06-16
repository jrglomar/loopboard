/**
 * get_sprint_report tool (v1.4, ADR-012).
 *
 * Computes a full sprint report: committed vs completed points, completion rate,
 * completed vs carryover issue lists, per-assignee breakdown.
 *
 * GET /rest/agile/1.0/sprint/{sprintId}  (meta)
 * GET /rest/agile/1.0/sprint/{sprintId}/issue  (issues)
 */

import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import type { IssueSummary, SprintRef } from "../lib/types.js";
import { getConfig } from "../lib/config.js";
import { getSprintMeta, getSprintIssues } from "../lib/jiraClient.js";
import {
  computeSprintPoints,
  computeByAssignee,
  makeDodPredicate,
} from "../lib/reportMath.js";

const schema = z.object({
  sprintId: z.number().int().positive(),
  maxResults: z.number().int().positive().default(100),
});

interface SprintReportOutput {
  sprint: SprintRef;
  committedPoints: number;
  completedPoints: number;
  completionRate: number;
  totalCount: number;
  completedCount: number;
  carryoverCount: number;
  blockedCount: number;
  completed: IssueSummary[];
  notCompleted: IssueSummary[];
  byAssignee: Array<{
    name: string;
    donePoints: number;
    totalPoints: number;
    doneCount: number;
    totalCount: number;
  }>;
}

async function handler(input: unknown): Promise<SprintReportOutput> {
  const args = schema.parse(input);
  const cfg = getConfig();

  // v1.5 (ADR-014): DoD = done OR code review. Build the shared predicate.
  const isDone = makeDodPredicate(cfg.JIRA_CODE_REVIEW_STATUSES);

  // Fetch sprint metadata
  const meta = await getSprintMeta(args.sprintId);

  // Fetch sprint issues
  const issues = await getSprintIssues(args.sprintId, args.maxResults);

  // Classify: completed = done OR code review, notCompleted = everything else
  const completed = issues.filter(isDone);
  const notCompleted = issues.filter((i) => !isDone(i));

  // Compute points using the DoD predicate
  const { committedPoints, completedPoints, completionRate } =
    computeSprintPoints(issues, isDone);

  // Blocked count (across all issues)
  const blockedCount = issues.filter((i) => i.blocked).length;

  // Per-assignee aggregation using the DoD predicate
  const byAssignee = computeByAssignee(issues, isDone);

  const sprint: SprintRef = {
    id: meta.id,
    name: meta.name,
    state: meta.state as "active" | "future" | "closed",
    startDate: meta.startDate,
    endDate: meta.endDate,
    completeDate: meta.completeDate,
    goal: meta.goal,
    boardId: meta.boardId,
  };

  return {
    sprint,
    committedPoints,
    completedPoints,
    completionRate,
    totalCount: issues.length,
    completedCount: completed.length,
    carryoverCount: notCompleted.length,
    blockedCount,
    completed,
    notCompleted,
    byAssignee,
  };
}

export const getSprintReportTool: ToolDef = {
  name: "get_sprint_report",
  description:
    "Get a full sprint report for a specific sprint: committed vs completed story points, " +
    "completion rate, completed issue list, carryover (not-completed) list, blocker count, " +
    "and a per-assignee breakdown (sorted by totalPoints desc, null assignee → 'Unassigned'). " +
    "Useful for retrospectives, stakeholder updates, and the Reports page.",
  schema,
  handler,
};
