// aging.ts — ticket aging / Scrum Work Item Age (v1.58, ADR-070). Pure; no React, no network.
//
// "Work Item Age" = how long a ticket has been in flight. The expectation is SCALED BY STORY
// POINTS: a 1-pointer sitting for 5 days is a problem; a 13-pointer at 5 days may be fine.
//   expectedDays = baseDays + daysPerPoint × storyPoints   (unpointed → baseDays only)
//   ratio        = ageDays / expectedDays  →  ok (<100%) · watch (≥100%) · overdue (≥150%)
//
// `today` is injected (never reads the clock) so the math is deterministic and unit-testable —
// the attention.ts convention, whose calendar-day helpers this reuses (ADR-052: calendar days,
// not business days — deliberately simple until noise warrants otherwise).
//
// Age comes from `IssueSummary.inProgressSince` (when the issue entered its CURRENT status,
// resolved from the Jira changelog by get_active_sprint's withAging option). Issues without it
// are EXCLUDED entirely rather than guessed at — an unknown age shows nothing, never a wrong number.

import { daysSince } from "./attention";
import type { IssueSummary } from "./types";

export type AgingTier = "ok" | "watch" | "overdue";

export interface AgingEntry {
  key: string;
  summary: string;
  url: string;
  status: string;
  ageDays: number;
  expectedDays: number;
  ratio: number;
  tier: AgingTier;
  storyPoints: number | null;
  /** No estimate — expectation falls back to baseDays, which is worth surfacing in the UI. */
  unpointed: boolean;
}

export interface AgingResult {
  /** Worst-first (highest ratio). Only issues with a known inProgressSince. */
  entries: AgingEntry[];
  okCount: number;
  watchCount: number;
  overdueCount: number;
}

/** Shape of the aging policy (mirrors the backend's getAgingPolicy / context .aging). */
export interface AgingPolicyLike {
  baseDays: number;
  daysPerPoint: number;
}

/** Tier thresholds: at/over the expectation = watch; half again over = overdue. */
export function tierFor(ratio: number): AgingTier {
  if (ratio >= 1.5) return "overdue";
  if (ratio >= 1) return "watch";
  return "ok";
}

/**
 * Age every in-flight issue against the points-scaled expectation, worst-first.
 *
 * Included: issues that are NOT done and carry a known `inProgressSince` (i.e. the in-progress
 * and code-review buckets when the sprint was fetched withAging). Everything else is skipped.
 */
export function computeAging(
  issues: IssueSummary[],
  policy: AgingPolicyLike,
  today: string
): AgingResult {
  const entries: AgingEntry[] = [];

  for (const issue of issues) {
    if (issue.statusCategory === "done") continue;
    if (!issue.inProgressSince) continue; // unknown → no age, never a guess

    const ageDays = Math.max(0, daysSince(issue.inProgressSince, today));
    const unpointed = issue.storyPoints == null;
    const expectedDays = policy.baseDays + policy.daysPerPoint * (issue.storyPoints ?? 0);
    // Guard a degenerate all-zero policy: any age against a zero expectation is unbounded.
    const ratio = expectedDays <= 0 ? (ageDays > 0 ? Infinity : 0) : ageDays / expectedDays;

    entries.push({
      key: issue.key,
      summary: issue.summary,
      url: issue.url,
      status: issue.status,
      ageDays,
      expectedDays,
      ratio,
      tier: tierFor(ratio),
      storyPoints: issue.storyPoints,
      unpointed,
    });
  }

  entries.sort((a, b) => (b.ratio - a.ratio) || (b.ageDays - a.ageDays));

  return {
    entries,
    okCount: entries.filter((e) => e.tier === "ok").length,
    watchCount: entries.filter((e) => e.tier === "watch").length,
    overdueCount: entries.filter((e) => e.tier === "overdue").length,
  };
}

/** "5d in Code Review (expected ~4d for 3 pts)" — shared by the card row and the board chip. */
export function agingDetail(e: AgingEntry): string {
  const expected = e.unpointed
    ? `expected ~${e.expectedDays}d, no estimate`
    : `expected ~${e.expectedDays}d for ${e.storyPoints} pt${e.storyPoints === 1 ? "" : "s"}`;
  return `${e.ageDays}d in ${e.status} (${expected})`;
}
