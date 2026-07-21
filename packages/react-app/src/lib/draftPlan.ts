// draftPlan.ts — pure rollup helpers for the Draft Capacity Plan card
// (CONTRACTS.md §4.30 v1.70, ADR-081)
//
// Joins a PO sprint's draft assignments (issueKey -> DraftShare[]) against the
// sprint's CURRENT ticket list, so the card can render per-developer totals and
// surface "honest edges" — tickets that left the sprint, drafted members who left
// the roster, or tickets that were never drafted — without ever silently
// dropping a draft entry.
//
// v1.70 (ADR-081): a ticket may be split across MULTIPLE developers, each
// carrying a DRAFT points slice (DraftShare). These rollups sum SHARE points,
// not the ticket's real Jira points — the two are allowed to diverge (capacity
// is advisory, ADR-079).
//
// No side effects; unit-tested in draftPlan.test.ts.

import type { DraftShare, IssueSummary } from "./types";

// ── draftTotalsByAccount ──────────────────────────────────────────────────────

export interface DraftMemberTotal {
  /** Sum of this member's share points across their drafted, still-in-sprint tickets. */
  points: number;
  /** Number of in-sprint tickets this member holds a share of. */
  count: number;
  /** The (issue, this member's share points) pairs, in sprint bucket order. */
  items: Array<{ issue: IssueSummary; points: number }>;
}

/**
 * Per-accountId drafted totals, joined against the sprint's current issue list.
 * Only shares on issues that are BOTH drafted (present in `assignments`) AND
 * still in the sprint (present in `issues`) are counted — a share on a ticket
 * that left the sprint is surfaced separately via `staleShareEntries`, not
 * silently rolled up here.
 */
export function draftTotalsByAccount(
  assignments: Record<string, DraftShare[]>,
  issues: IssueSummary[]
): Record<string, DraftMemberTotal> {
  const totals: Record<string, DraftMemberTotal> = {};

  for (const issue of issues) {
    const shares = assignments[issue.key];
    if (!shares || shares.length === 0) continue;

    for (const share of shares) {
      const bucket = totals[share.accountId] ?? { points: 0, count: 0, items: [] };
      bucket.points += share.points;
      bucket.count += 1;
      bucket.items.push({ issue, points: share.points });
      totals[share.accountId] = bucket;
    }
  }

  return totals;
}

// ── allocatedByIssue ──────────────────────────────────────────────────────────

/** Sum of share points drafted per ticket (regardless of whether it's still in-sprint). */
export function allocatedByIssue(assignments: Record<string, DraftShare[]>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [issueKey, shares] of Object.entries(assignments)) {
    result[issueKey] = shares.reduce((sum, share) => sum + share.points, 0);
  }
  return result;
}

// ── unplannedIssues ───────────────────────────────────────────────────────────

/** Sprint issues that have NO shares drafted yet (key absent, or an empty share array). */
export function unplannedIssues(
  assignments: Record<string, DraftShare[]>,
  issues: IssueSummary[]
): IssueSummary[] {
  return issues.filter((issue) => {
    const shares = assignments[issue.key];
    return !shares || shares.length === 0;
  });
}

// ── staleShareEntries ─────────────────────────────────────────────────────────

export interface StaleShareEntry {
  issueKey: string;
  share: DraftShare;
  reason: "ticket-gone" | "member-gone";
}

/**
 * Individual shares that need attention — the store is only ever mutated by an
 * explicit user action, so these are surfaced as removable rows instead of
 * being silently dropped:
 *  - "ticket-gone": the share's issueKey is no longer among `issues` (moved,
 *    resolved out of scope, etc.) — every share on that ticket is reported.
 *  - "member-gone": the ticket is still in-sprint, but the share's accountId is
 *    no longer in `rosterAccountIds` (removed from the Dev team).
 * A ticket that is BOTH gone from the sprint AND held by an ex-member reports
 * only "ticket-gone" (the more fundamental problem) for that share.
 */
export function staleShareEntries(
  assignments: Record<string, DraftShare[]>,
  issues: IssueSummary[],
  rosterAccountIds: Set<string>
): StaleShareEntry[] {
  const issueKeys = new Set(issues.map((issue) => issue.key));
  const result: StaleShareEntry[] = [];

  for (const [issueKey, shares] of Object.entries(assignments)) {
    const ticketGone = !issueKeys.has(issueKey);
    for (const share of shares) {
      if (ticketGone) {
        result.push({ issueKey, share, reason: "ticket-gone" });
      } else if (!rosterAccountIds.has(share.accountId)) {
        result.push({ issueKey, share, reason: "member-gone" });
      }
    }
  }

  return result;
}
