// draftPlan.ts — pure rollup helpers for the Draft Capacity Plan card
// (CONTRACTS.md §4.30 v1.68, ADR-079)
//
// Joins a PO sprint's draft assignments (issueKey -> DraftAssignment) against the
// sprint's CURRENT ticket list, so the card can render per-developer totals and
// surface "honest edges" — tickets that left the sprint, or were never drafted —
// without ever silently dropping a draft entry.
//
// No side effects; unit-tested in draftPlan.test.ts.

import type { DraftAssignment, IssueSummary } from "./types";

// ── draftTotalsByAccount ──────────────────────────────────────────────────────

export interface DraftMemberTotal {
  /** Sum of storyPoints (?? 0) across this member's drafted, still-in-sprint tickets. */
  points: number;
  count: number;
  issues: IssueSummary[];
}

/**
 * Per-accountId drafted totals, joined against the sprint's current issue list.
 * Only issues that are BOTH drafted (present in `assignments`) AND still in the
 * sprint (present in `issues`) are counted — a ticket that left the sprint is
 * surfaced separately via `staleDraftEntries`, not silently rolled up here.
 */
export function draftTotalsByAccount(
  assignments: Record<string, DraftAssignment>,
  issues: IssueSummary[]
): Record<string, DraftMemberTotal> {
  const totals: Record<string, DraftMemberTotal> = {};

  for (const issue of issues) {
    const assignment = assignments[issue.key];
    if (!assignment) continue;

    const bucket = totals[assignment.accountId] ?? { points: 0, count: 0, issues: [] };
    bucket.points += issue.storyPoints ?? 0;
    bucket.count += 1;
    bucket.issues.push(issue);
    totals[assignment.accountId] = bucket;
  }

  return totals;
}

// ── unplannedIssues ───────────────────────────────────────────────────────────

/** Sprint issues that have NOT been drafted to anyone yet. */
export function unplannedIssues(
  assignments: Record<string, DraftAssignment>,
  issues: IssueSummary[]
): IssueSummary[] {
  return issues.filter((issue) => !(issue.key in assignments));
}

// ── staleDraftEntries ─────────────────────────────────────────────────────────

export interface StaleDraftEntry {
  issueKey: string;
  assignment: DraftAssignment;
}

/**
 * Draft entries whose ticket is no longer in the sprint (moved, resolved out of
 * scope, etc.) — the store is only ever mutated by an explicit user action, so
 * these are surfaced as removable rows instead of being silently dropped.
 */
export function staleDraftEntries(
  assignments: Record<string, DraftAssignment>,
  issues: IssueSummary[]
): StaleDraftEntry[] {
  const issueKeys = new Set(issues.map((issue) => issue.key));
  return Object.entries(assignments)
    .filter(([issueKey]) => !issueKeys.has(issueKey))
    .map(([issueKey, assignment]) => ({ issueKey, assignment }));
}
