// Board + offset-policy context (ADR-017; v1.51 ADR-062).
//
// v1.51 FIX: boards and the offset policy now come from the signed-in user's context
// (GET /api/me/context, per-user — resolved from their Jira + admin/global/per-user overrides),
// NOT the global, unauthenticated GET /api/health. Reading /api/health meant a per-user board/env
// override never reached the UI — the app always showed the .env boards.
//
// The hooks read AuthContext, which already fetched /api/me/context once — so there's a single
// source of truth and no extra round-trip.

import { useAuth } from "../context/AuthContext";
import type { Boards, OffsetPolicy } from "./types";

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

/**
 * Pure: normalize a `{ dev, po }` boards object (per-side arrays, or a legacy single object) into a
 * `Boards`, or null when either side is missing/empty/invalid. Exported for testing + reuse.
 */
export function normalizeBoards(raw: unknown): Boards | null {
  if (!raw || typeof raw !== "object") return null;
  const { dev: rawDev, po: rawPo } = raw as { dev?: unknown; po?: unknown };
  const dev = normalizeSide(rawDev);
  const po = normalizeSide(rawPo);
  return dev && po ? { dev, po } : null;
}

// ── useBoards hook ────────────────────────────────────────────────────────────

export interface UseBoardsState {
  boards: Boards | null;
  loading: boolean;
}

/**
 * The signed-in user's boards, from their context (per-user). `boards` is null while the context
 * loads OR when it doesn't resolve to a valid PO+Dev pair. The board toggle renders only when non-null.
 */
export function useBoards(): UseBoardsState {
  const { context } = useAuth();
  if (!context) return { boards: null, loading: true };
  return { boards: normalizeBoards(context.boards), loading: false };
}

// ── Offset policy (v1.26, ADR-038; per-user v1.51, ADR-062) ────────────────────

const DEFAULT_POLICY: OffsetPolicy = { requiredPoints: 8, offsetThreshold: 2 };

/** The signed-in user's effective offset policy (per-user), or the default until the context loads. */
export function usePolicy(): OffsetPolicy {
  const { context } = useAuth();
  return context?.policy ?? DEFAULT_POLICY;
}
