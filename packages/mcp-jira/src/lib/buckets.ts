/**
 * Issue bucketing helpers — pure functions, no side effects.
 *
 * Code-review detection is a bucketing concept only; IssueSummary.statusCategory
 * always reports Jira's raw category unchanged.
 */

import type { IssueSummary } from "./types.js";

/**
 * Parse the JIRA_CODE_REVIEW_STATUSES env string into a normalized string[]:
 * each entry is lowercased, trimmed, and empty entries are dropped.
 */
export function parseCodeReviewStatuses(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.toLowerCase().trim())
    .filter((s) => s.length > 0);
}

/**
 * Returns true iff the issue is "in code review":
 * - statusCategory must be "inprogress" (the category guard)
 * - status name lowercased+trimmed must exactly match one entry in codeReviewStatuses
 *
 * A done-category status like "Reviewed" can never pass the category guard.
 * A todo-category status like "Ready for Review" can never pass either.
 */
export function isCodeReview(
  issue: Pick<IssueSummary, "statusCategory" | "status">,
  codeReviewStatuses: string[]
): boolean {
  if (issue.statusCategory !== "inprogress") return false;
  const normalised = issue.status.toLowerCase().trim();
  return codeReviewStatuses.includes(normalised);
}
