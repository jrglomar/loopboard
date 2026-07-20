/**
 * Leaves store — JSON file read/write for per-sprint, TYPED leave days.
 *
 * Shape (v1.26, ADR-038): { [sprintId]: { [assignee]: { [YYYY-MM-DD]: LeaveType } } }
 * LeaveType ∈ "VL" | "EL" | "Holiday" | "Offset".
 *
 * Back-compat: the legacy shape was { [sprintId]: { [assignee]: string[] } } (untyped dates).
 * `readLeaves` NORMALIZES on read — a legacy `string[]` becomes `{ [date]: "VL" }` — so the
 * existing `.invokeboard-leaves.json` keeps working without a migration step.
 *
 * v1.5 (ADR-016): first stateful store. v1.65 (ADR-077): reads/writes go through the storage
 * port (json driver by default — same file paths as before; sqlite when STORAGE_DRIVER=sqlite).
 * Reads tolerate a missing/corrupt doc (returns {}).
 */

import { readDoc, writeDoc, currentScope } from "./storage/index.js";

export type LeaveType = "VL" | "EL" | "Holiday" | "Offset";
export const LEAVE_TYPES: readonly LeaveType[] = ["VL", "EL", "Holiday", "Offset"];

/** Per-assignee map of ISO date (YYYY-MM-DD) → leave type. */
export type AssigneeLeaves = Record<string, LeaveType>;

/** File-level shape: sprintId → assignee → (date → type). */
export type LeavesFile = Record<string, Record<string, AssigneeLeaves>>;

function isLeaveType(s: unknown): s is LeaveType {
  return typeof s === "string" && (LEAVE_TYPES as readonly string[]).includes(s);
}

/** Normalize a stored assignee value (legacy string[] OR typed map) → a typed map. */
export function normalizeAssigneeLeaves(value: unknown): AssigneeLeaves {
  const out: AssigneeLeaves = {};
  if (Array.isArray(value)) {
    for (const d of value) if (typeof d === "string") out[d] = "VL"; // legacy untyped → VL
    return out;
  }
  if (value && typeof value === "object") {
    for (const [date, type] of Object.entries(value as Record<string, unknown>)) {
      out[date] = isLeaveType(type) ? type : "VL";
    }
  }
  return out;
}

/** Read the leaves file, normalizing every assignee entry to the typed shape. Returns {} on error. */
export function readLeaves(): LeavesFile {
  const parsed = readDoc(currentScope(), "leaves");
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const out: LeavesFile = {};
  for (const [sprintId, byAssignee] of Object.entries(parsed as Record<string, unknown>)) {
    if (!byAssignee || typeof byAssignee !== "object") continue;
    const norm: Record<string, AssigneeLeaves> = {};
    for (const [assignee, value] of Object.entries(byAssignee as Record<string, unknown>)) {
      norm[assignee] = normalizeAssigneeLeaves(value);
    }
    out[sprintId] = norm;
  }
  return out;
}

/** Write the leaves file (storage port — json driver mkdirs + writes atomically; see storage/). */
export function writeLeaves(data: LeavesFile): void {
  writeDoc(currentScope(), "leaves", data);
}
