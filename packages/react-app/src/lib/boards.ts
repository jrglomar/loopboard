// Board context loader — CONTRACTS.md §2, ADR-017, v1.6
//
// getBoards() reads GET /api/health (jira bridge) and returns the .boards field.
// Returns null when boards is absent (older bridge) or on any error — never throws.
// Callers should show the Dev/PO toggle only when boards is non-null.

import { useState, useEffect } from "react";
import type { Boards } from "./types";

const JIRA_BASE =
  (import.meta.env.VITE_MCP_JIRA_URL as string | undefined) ??
  "http://localhost:4001";

/**
 * Fetch the boards config from GET /api/health (jira) → .boards.
 * Returns null when absent (older bridge) or on any error — never throws.
 * CONTRACTS.md §2 v1.6, ADR-017
 */
export async function getBoards(): Promise<Boards | null> {
  try {
    const response = await fetch(`${JIRA_BASE}/api/health`);
    if (!response.ok) return null;
    const body = await response.json() as Record<string, unknown>;
    const boards = body.boards as Boards | undefined;
    if (
      !boards ||
      typeof boards !== "object" ||
      typeof boards.dev?.id !== "number" ||
      typeof boards.dev?.projectKey !== "string" ||
      typeof boards.po?.id !== "number" ||
      typeof boards.po?.projectKey !== "string"
    ) {
      return null;
    }
    return boards;
  } catch {
    // Network failure, parse failure — never throw; return null (older bridge fallback)
    return null;
  }
}

// ── useBoards hook ────────────────────────────────────────────────────────────

export interface UseBoardsState {
  boards: Boards | null;
  loading: boolean;
}

/**
 * Loads boards once on mount from GET /api/health → .boards.
 * boards is null while loading OR when the older bridge doesn't expose them.
 * The toggle should only render when boards is non-null.
 *
 * ADR-017 v1.6
 */
export function useBoards(): UseBoardsState {
  // perf: load once — boards come from server config, no need to refetch
  const [boards, setBoards] = useState<Boards | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getBoards().then((result) => {
      if (!cancelled) {
        setBoards(result);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { boards, loading };
}
