// Board context loader — CONTRACTS.md §2, ADR-017, v1.6
//
// getBoards() reads GET /api/health (jira bridge) and returns the .boards field.
// Returns null when boards is absent (older bridge) or on any error — never throws.
// Callers should show the Dev/PO toggle only when boards is non-null.

import { useState, useEffect } from "react";
import type { Boards, OffsetPolicy } from "./types";

const JIRA_BASE =
  (import.meta.env.VITE_MCP_JIRA_URL as string | undefined) ??
  "http://localhost:4001";

/**
 * Fetch the boards config from GET /api/health (jira) → .boards.
 * Returns null when absent (older bridge) or on any error — never throws.
 * CONTRACTS.md §2 v1.6, ADR-017
 */
type BoardRef = Boards["dev"][number];

/** Coerce one side (array — v1.25 — or legacy object) into a non-empty BoardRef[] or null. */
function normalizeSide(side: unknown): BoardRef[] | null {
  const list = Array.isArray(side) ? side : side ? [side] : [];
  const valid = list.filter(
    (b): b is BoardRef =>
      !!b && typeof (b as BoardRef).id === "number" && typeof (b as BoardRef).projectKey === "string"
  );
  return valid.length > 0 ? valid : null;
}

export async function getBoards(): Promise<Boards | null> {
  try {
    const response = await fetch(`${JIRA_BASE}/api/health`);
    if (!response.ok) return null;
    const body = await response.json() as Record<string, unknown>;
    const raw = body.boards as { dev?: unknown; po?: unknown } | undefined;
    if (!raw || typeof raw !== "object") return null;
    // v1.25 (ADR-037): boards are per-side arrays; an older object-shaped bridge is
    // normalized to a 1-element list so the app keeps working.
    const dev = normalizeSide(raw.dev);
    const po = normalizeSide(raw.po);
    if (!dev || !po) return null;
    return { dev, po };
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

// ── Offset policy (v1.26, ADR-038) ────────────────────────────────────────────

const DEFAULT_POLICY: OffsetPolicy = { requiredPoints: 8, offsetThreshold: 2 };

/** Fetch the offset policy from GET /api/health .policy. Defaults on absence/error. */
export async function getPolicy(): Promise<OffsetPolicy> {
  try {
    const response = await fetch(`${JIRA_BASE}/api/health`);
    if (!response.ok) return DEFAULT_POLICY;
    const body = (await response.json()) as Record<string, unknown>;
    const p = body.policy as OffsetPolicy | undefined;
    if (p && typeof p.requiredPoints === "number" && typeof p.offsetThreshold === "number") return p;
    return DEFAULT_POLICY;
  } catch {
    return DEFAULT_POLICY;
  }
}

/** Loads the offset policy once on mount (defaults until loaded). */
export function usePolicy(): OffsetPolicy {
  const [policy, setPolicy] = useState<OffsetPolicy>(DEFAULT_POLICY);
  useEffect(() => {
    let cancelled = false;
    getPolicy().then((p) => { if (!cancelled) setPolicy(p); });
    return () => { cancelled = true; };
  }, []);
  return policy;
}
