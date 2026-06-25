// Typed GitHub hooks — CONTRACTS.md §6
import { useCallback, useEffect, useRef, useState } from "react";
import { callTool } from "../lib/mcpClient";
import {
  type ListPrsOutput,
  type LinkPrOutput,
  type GetPrReviewsOutput,
  type PrReviewStatus,
} from "../lib/types";
import { useMCP, type UseMCPState } from "./useMCP";

// ── usePrs ────────────────────────────────────────────────────────────────────

/**
 * Fetches open PRs from the configured GitHub repo.
 * Auto-fetches on mount.
 */
export function usePrs(repo?: string): UseMCPState<ListPrsOutput> {
  const fn = useCallback(
    () =>
      callTool<ListPrsOutput>("github", "list_prs", repo ? { repo } : {}),
    [repo]
  );

  const state = useMCP(fn);

  useEffect(() => {
    state.run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}

// ── linkPr ────────────────────────────────────────────────────────────────────

/** Links a PR to a Jira ticket (or auto-detects keys from PR metadata) */
export async function linkPr(
  number: number,
  ticketKey?: string,
  repo?: string
): Promise<LinkPrOutput> {
  return callTool<LinkPrOutput>("github", "link_pr_to_ticket", {
    number,
    ...(ticketKey ? { ticketKey } : {}),
    ...(repo ? { repo } : {}),
  });
}

// ── getPrReviews / usePrReviews (v1.21, ADR-033) ──────────────────────────────

/** Fetch the review/approval status for a batch of PR numbers (current-sprint linked PRs). */
export async function getPrReviews(
  numbers: number[],
  repo?: string
): Promise<Record<number, PrReviewStatus>> {
  if (numbers.length === 0) return {};
  const res = await callTool<GetPrReviewsOutput>("github", "get_pr_reviews", {
    numbers,
    ...(repo ? { repo } : {}),
  });
  return res.reviews;
}

/**
 * Review/approval status keyed by PR number for the given PRs. Refetches when the SET of
 * numbers changes (order-independent). Failures (e.g. github down) resolve to {} so the
 * caller simply renders no badges. CONTRACTS.md §5.6.
 */
export function usePrReviews(numbers: number[]): {
  data: Record<number, PrReviewStatus>;
  loading: boolean;
} {
  const [data, setData] = useState<Record<number, PrReviewStatus>>({});
  const [loading, setLoading] = useState(false);
  // Stable key so the effect only refires when the set of numbers actually changes.
  const key = [...numbers].sort((a, b) => a - b).join(",");
  const reqId = useRef(0);

  useEffect(() => {
    if (numbers.length === 0) { setData({}); return; }
    const myReq = ++reqId.current;
    setLoading(true);
    getPrReviews(numbers)
      .then((reviews) => { if (myReq === reqId.current) { setData(reviews); setLoading(false); } })
      .catch(() => { if (myReq === reqId.current) { setData({}); setLoading(false); } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { data, loading };
}
