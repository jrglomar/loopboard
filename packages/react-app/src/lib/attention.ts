// Attention nudges (v1.42, ADR-052) — a pure derivation over the current sprint's issues
// and their linked PRs, surfacing what needs a human's attention today:
//   • stale in-progress — an in-progress issue not updated in ≥ staleDays days
//   • unassigned        — an unfinished issue with no assignee
//   • pr_review         — a linked PR that is open and still awaiting review
// Deterministic + side-effect-free so it is trivially unit-tested (no network, no clock).

import type { IssueSummary, LinkedPr } from "./types";

export type AttentionKind = "stale" | "unassigned" | "pr_review";

export interface AttentionItem {
  kind: AttentionKind;
  key: string; // the issue key
  summary: string; // the issue summary (or PR title fallback)
  url: string; // browse URL (issue) or PR URL (pr_review)
  detail: string; // short human sub-label
}

export interface AttentionResult {
  items: AttentionItem[];
  staleCount: number;
  unassignedCount: number;
  prReviewCount: number;
}

export interface BuildAttentionInput {
  issues: IssueSummary[];
  /** Linked PRs keyed by issue key (from get_issue_pull_requests). */
  prsByKey: Record<string, LinkedPr[]>;
  /** Today as YYYY-MM-DD (the caller supplies it — keeps this pure/testable). */
  today: string;
  /** In-progress issues untouched for this many days count as stale (default 3). */
  staleDays?: number;
}

/** UTC midnight epoch for a full ISO timestamp or a YYYY-MM-DD date. */
function toUtcMidnight(iso: string): number {
  const d = new Date(iso);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Whole days from an ISO timestamp to `today` (YYYY-MM-DD). Negative if in the future. */
function daysSince(iso: string, today: string): number {
  return Math.floor((toUtcMidnight(today) - toUtcMidnight(iso)) / 86_400_000);
}

export function buildAttention({
  issues,
  prsByKey,
  today,
  staleDays = 3,
}: BuildAttentionInput): AttentionResult {
  const stale: AttentionItem[] = [];
  const unassigned: AttentionItem[] = [];
  const prReview: AttentionItem[] = [];

  for (const issue of issues) {
    // Stale: in-progress and untouched for ≥ staleDays days (needs a known updatedAt).
    let isStale = false;
    if (issue.statusCategory === "inprogress" && issue.updatedAt) {
      const age = daysSince(issue.updatedAt, today);
      if (age >= staleDays) {
        isStale = true;
        stale.push({
          kind: "stale",
          key: issue.key,
          summary: issue.summary,
          url: issue.url,
          detail: `No update in ${age} day${age === 1 ? "" : "s"}`,
        });
      }
    }

    // Unassigned: unfinished work with nobody on it. Don't double-flag a stale issue.
    if (!isStale && issue.statusCategory !== "done" && !issue.assignee) {
      unassigned.push({
        kind: "unassigned",
        key: issue.key,
        summary: issue.summary,
        url: issue.url,
        detail: "Unassigned",
      });
    }
  }

  // PRs still awaiting review, across every linked issue.
  const summaryByKey = new Map(issues.map((i) => [i.key, i.summary]));
  for (const [key, prs] of Object.entries(prsByKey)) {
    for (const pr of prs) {
      if (pr.status === "open" && pr.decision === "review_required") {
        prReview.push({
          kind: "pr_review",
          key,
          summary: summaryByKey.get(key) ?? pr.title,
          url: pr.url,
          detail: `PR awaiting review${pr.repo ? ` · ${pr.repo}` : ""}`,
        });
      }
    }
  }

  return {
    items: [...stale, ...unassigned, ...prReview],
    staleCount: stale.length,
    unassignedCount: unassigned.length,
    prReviewCount: prReview.length,
  };
}
