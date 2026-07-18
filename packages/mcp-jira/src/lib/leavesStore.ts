/**
 * Leaves store — JSON file read/write for per-sprint, TYPED leave days.
 *
 * Shape (v1.26, ADR-038): { [sprintId]: { [assignee]: { [YYYY-MM-DD]: LeaveType } } }
 * LeaveType ∈ "VL" | "EL" | "Holiday" | "Offset".
 *
 * Back-compat: the legacy shape was { [sprintId]: { [assignee]: string[] } } (untyped dates).
 * `readLeaves` NORMALIZES on read — a legacy `string[]` becomes `{ [date]: "VL" }` — so the
 * existing `.loopboard-leaves.json` keeps working without a migration step.
 *
 * v1.5 (ADR-016): first stateful store. Path read from config at call time (getLeavesFilePath()).
 * Reads tolerate a missing/corrupt file (returns {}). Writes create the file + parent dirs.
 */

import * as fs from "fs";
import * as path from "path";
import { getLeavesFilePath } from "./config.js";
import { writeJsonAtomic } from "./atomicFile.js";

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
  const filePath = getLeavesFilePath();
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
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
  } catch {
    return {};
  }
}

/** Write the leaves file, creating parent directories as needed. */
export function writeLeaves(data: LeavesFile): void {
  const filePath = getLeavesFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  writeJsonAtomic(filePath, data);
}
