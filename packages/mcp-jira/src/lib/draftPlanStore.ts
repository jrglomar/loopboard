/**
 * Draft-plan store — synchronous JSON file read/write for the PO's per-sprint DRAFT capacity
 * plan (v1.68, ADR-079).
 *
 * Shape: { [sprintId: string]: { devSprintId: number | null; assignments: Record<issueKey, DraftAssignment> } }
 *
 * DRAFT ONLY — get_draft_plan/set_draft_plan NEVER call Jira. Reads/writes go through the
 * storage port (json driver by default; still honors JIRA_DRAFT_PLAN_FILE), same pattern as
 * teamStore.ts / impedimentsStore.ts.
 *
 * Reads tolerate a missing or corrupt doc (returns {}).
 * Writes may throw if the driver rejects the operation (e.g. FS/DB error).
 *
 * Never logs accountIds or any PII.
 */

import type { DraftAssignment } from "./types.js";
import { readDoc, writeDoc, currentScope } from "./storage/index.js";

/** Per-sprint draft entry: the Dev-board sprint this draft targets + issueKey → DraftAssignment. */
export interface DraftPlanEntry {
  devSprintId: number | null;
  assignments: Record<string, DraftAssignment>;
}

/**
 * File-level shape: sprintId (as string key) → DraftPlanEntry
 */
export type DraftPlanFile = Record<string, DraftPlanEntry>;

/**
 * Read the draft-plan file and return its contents.
 * Returns {} on ENOENT or any JSON parse error (never throws).
 */
export function readDraftPlans(): DraftPlanFile {
  const parsed = readDoc(currentScope(), "draft-plan");
  // Validate that we have a plain object at the top level
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  return parsed as DraftPlanFile;
}

/**
 * Write the draft-plan file via the storage port.
 * May throw on driver errors (e.g. permission denied writing, disk full).
 */
export function writeDraftPlans(data: DraftPlanFile): void {
  writeDoc(currentScope(), "draft-plan", data);
}
