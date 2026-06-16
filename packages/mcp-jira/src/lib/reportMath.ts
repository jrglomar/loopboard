/**
 * Shared pure functions for sprint report point math (v1.4, updated v1.5).
 *
 * Used by get_sprint_report and get_velocity so math is not duplicated.
 * No side effects, no network calls.
 *
 * v1.5 (ADR-014): DoD = done OR code review. All point/count aggregation
 * functions accept an optional `isDone` predicate so callers share the same
 * definition without duplicating it.
 */

import type { IssueSummary } from "./types.js";
import { isCodeReview, parseCodeReviewStatuses } from "./buckets.js";

/**
 * Build the v1.5 DoD predicate: an issue is "completed" if its statusCategory
 * is "done" OR it matches the code-review detection.
 *
 * @param codeReviewStatusesRaw  The raw JIRA_CODE_REVIEW_STATUSES string
 *                               (e.g. "code review,in review,peer review,review").
 */
export function makeDodPredicate(
  codeReviewStatusesRaw: string
): (issue: IssueSummary) => boolean {
  const crStatuses = parseCodeReviewStatuses(codeReviewStatusesRaw);
  return (issue) =>
    issue.statusCategory === "done" || isCodeReview(issue, crStatuses);
}

export interface SprintPoints {
  committedPoints: number;
  completedPoints: number;
  completionRate: number;
}

/**
 * Compute committed vs completed story points for a list of issues.
 *
 * - committedPoints: sum of ALL issues' points (null → 0)
 * - completedPoints: sum of issues passing `isDone` (null points → 0)
 * - completionRate: completedPoints / committedPoints; 0 when committedPoints === 0
 *
 * When `isDone` is omitted the legacy predicate (statusCategory === "done") is used,
 * preserving backward compat for callers that have not yet been updated.
 */
export function computeSprintPoints(
  issues: IssueSummary[],
  isDone?: (issue: IssueSummary) => boolean
): SprintPoints {
  const predicate = isDone ?? ((i: IssueSummary) => i.statusCategory === "done");
  const committedPoints = issues.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0);
  const completedPoints = issues
    .filter(predicate)
    .reduce((sum, i) => sum + (i.storyPoints ?? 0), 0);
  const completionRate =
    committedPoints === 0 ? 0 : completedPoints / committedPoints;
  return { committedPoints, completedPoints, completionRate };
}

export interface AssigneeStats {
  name: string;
  donePoints: number;
  totalPoints: number;
  doneCount: number;
  totalCount: number;
}

/**
 * Aggregate per-assignee stats from a list of issues.
 * null assignee → "Unassigned". Sorted by totalPoints descending.
 *
 * `isDone` controls what counts as "done" for donePoints/doneCount.
 * When omitted, falls back to the legacy statusCategory === "done" predicate.
 */
export function computeByAssignee(
  issues: IssueSummary[],
  isDone?: (issue: IssueSummary) => boolean
): AssigneeStats[] {
  const predicate = isDone ?? ((i: IssueSummary) => i.statusCategory === "done");
  const map = new Map<string, AssigneeStats>();

  for (const issue of issues) {
    const name = issue.assignee ?? "Unassigned";
    const existing = map.get(name) ?? {
      name,
      donePoints: 0,
      totalPoints: 0,
      doneCount: 0,
      totalCount: 0,
    };
    existing.totalCount += 1;
    existing.totalPoints += issue.storyPoints ?? 0;
    if (predicate(issue)) {
      existing.doneCount += 1;
      existing.donePoints += issue.storyPoints ?? 0;
    }
    map.set(name, existing);
  }

  return [...map.values()].sort((a, b) => b.totalPoints - a.totalPoints);
}
