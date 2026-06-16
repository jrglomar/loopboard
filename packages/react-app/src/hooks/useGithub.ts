// Typed GitHub hooks — CONTRACTS.md §6
import { useCallback, useEffect } from "react";
import { callTool } from "../lib/mcpClient";
import { type ListPrsOutput, type LinkPrOutput } from "../lib/types";
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
