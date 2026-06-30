// prBadge.ts (v1.27, ADR-039) — pure summary for the "has linked PR" badge.
// Reduces a ticket's linked PRs (from get_issue_pull_requests / useIssuePullRequests)
// into the compact info a board/report badge needs. No React, no network.

import type { LinkedPr } from "./types";

/** Aggregate review tone over a ticket's still-open PRs (drives the badge tint). */
export type PrTone = "approved" | "changes" | "review" | "done";

export interface PrBadgeInfo {
  /** Total linked PRs (all states). */
  count: number;
  /** The PR to open on click — newest by lastUpdate (stable fallback = first). */
  newest: LinkedPr;
  /** Aggregate review tone over the OPEN PRs. */
  tone: PrTone;
  /** How many of the linked PRs are still open (or unknown state). */
  openCount: number;
}

/**
 * Summarize a ticket's linked PRs for a board/report badge. Returns null when there
 * are none (caller renders nothing).
 */
export function summarizePrBadge(prs: LinkedPr[] | undefined): PrBadgeInfo | null {
  if (!prs || prs.length === 0) return null;

  // newest = latest lastUpdate; undefined sorts last. Stable fallback = first entry.
  const sorted = [...prs].sort((a, b) => (b.lastUpdate ?? "").localeCompare(a.lastUpdate ?? ""));
  const newest = sorted[0]!;

  const open = prs.filter((p) => p.status === "open" || p.status === "unknown");
  const openCount = open.length;

  let tone: PrTone;
  if (open.some((p) => p.decision === "changes_requested")) tone = "changes";
  else if (openCount === 0) tone = "done"; // every linked PR is merged/closed
  else if (open.some((p) => p.decision === "approved")) tone = "approved";
  else tone = "review";

  return { count: prs.length, newest, tone, openCount };
}
