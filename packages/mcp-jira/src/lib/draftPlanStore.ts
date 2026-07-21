/**
 * Draft-plan store — synchronous JSON file read/write for the PO's per-sprint DRAFT capacity
 * plan (v1.68, ADR-079; multi-developer point split v1.70, ADR-081).
 *
 * Shape: { [sprintId: string]: { devSprintId: number | null; assignments: Record<issueKey, DraftShare[]> } }
 *
 * DRAFT ONLY — get_draft_plan/set_draft_plan NEVER call Jira. Reads/writes go through the
 * storage port (json driver by default; still honors JIRA_DRAFT_PLAN_FILE), same pattern as
 * teamStore.ts / impedimentsStore.ts.
 *
 * Reads tolerate a missing or corrupt doc (returns {}) AND migrate pre-v1.70 data in place, so
 * callers (get_draft_plan) always see the current DraftShare[] shape, never the legacy one:
 *  - an issueKey value that is already an ARRAY is kept, with each element coerced to a
 *    well-formed { accountId, displayName, points } (a missing/NaN points defaults to 0);
 *  - a legacy single-object value ({ accountId, displayName }) is wrapped to a one-element
 *    array with points: 0;
 *  - anything else (null, string, number, ...) is dropped — that issueKey is simply omitted.
 * This normalization never throws.
 *
 * Writes may throw if the driver rejects the operation (e.g. FS/DB error).
 *
 * Never logs accountIds or any PII.
 */

import type { DraftShare } from "./types.js";
import { readDoc, writeDoc, currentScope } from "./storage/index.js";

/** Per-sprint draft entry: the Dev-board sprint this draft targets + issueKey → DraftShare[] (one or more developer shares of the ticket's DRAFT points). */
export interface DraftPlanEntry {
  devSprintId: number | null;
  assignments: Record<string, DraftShare[]>;
}

/**
 * File-level shape: sprintId (as string key) → DraftPlanEntry
 */
export type DraftPlanFile = Record<string, DraftPlanEntry>;

/**
 * Coerce one raw array element to a well-formed DraftShare. Never throws: a non-object element,
 * or one missing accountId/displayName, yields empty strings for those fields; a missing or
 * non-finite points value defaults to 0.
 */
function coerceShare(raw: unknown): DraftShare {
  const r = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const points = r["points"];
  return {
    accountId: typeof r["accountId"] === "string" ? r["accountId"] : "",
    displayName: typeof r["displayName"] === "string" ? r["displayName"] : "",
    points: typeof points === "number" && Number.isFinite(points) ? points : 0,
  };
}

/**
 * Normalize one sprint entry's raw assignments map to the current DraftShare[] shape (pure,
 * never throws). See the module doc-comment for the per-key migration rules.
 */
function normalizeAssignments(raw: unknown): Record<string, DraftShare[]> {
  const out: Record<string, DraftShare[]> = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return out;
  }
  for (const [issueKey, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      out[issueKey] = value.map(coerceShare);
    } else if (typeof value === "object" && value !== null) {
      // Legacy v1.68/v1.69 single-object assignment — wrap to a one-element array.
      const r = value as Record<string, unknown>;
      out[issueKey] = [
        {
          accountId: typeof r["accountId"] === "string" ? r["accountId"] : "",
          displayName: typeof r["displayName"] === "string" ? r["displayName"] : "",
          points: 0,
        },
      ];
    }
    // else: null/garbage — drop the key.
  }
  return out;
}

/**
 * Read the draft-plan file and return its contents, migrating any pre-v1.70 legacy assignment
 * shapes in place (see module doc-comment). Returns {} on ENOENT or any JSON parse error, and
 * for any top-level non-object doc (never throws).
 */
export function readDraftPlans(): DraftPlanFile {
  const parsed = readDoc(currentScope(), "draft-plan");
  // Validate that we have a plain object at the top level
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }

  const normalized: DraftPlanFile = {};
  for (const [sprintId, rawEntry] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof rawEntry !== "object" || rawEntry === null || Array.isArray(rawEntry)) {
      continue;
    }
    const entry = rawEntry as { devSprintId?: number | null; assignments?: unknown };
    normalized[sprintId] = {
      devSprintId: entry.devSprintId ?? null,
      assignments: normalizeAssignments(entry.assignments),
    };
  }
  return normalized;
}

/**
 * Write the draft-plan file via the storage port.
 * May throw on driver errors (e.g. permission denied writing, disk full).
 */
export function writeDraftPlans(data: DraftPlanFile): void {
  writeDoc(currentScope(), "draft-plan", data);
}
