// offset.ts — pure offset-points helpers (v1.26, ADR-038). No side effects; unit-tested.

import type { AssigneeLeaves, LeaveType } from "./types";

export const LEAVE_TYPES: LeaveType[] = ["VL", "EL", "Holiday", "Offset"];

/** Count an assignee's leave days PER TYPE that fall on a sprint working day. */
export function leaveDaysByType(
  typed: AssigneeLeaves,
  workingDays: string[]
): Record<LeaveType, number> {
  const counts: Record<LeaveType, number> = { VL: 0, EL: 0, Holiday: 0, Offset: 0 };
  const ws = new Set(workingDays);
  for (const [date, type] of Object.entries(typed)) {
    if (ws.has(date.slice(0, 10))) counts[type] += 1;
  }
  return counts;
}

/** Total leave days (all types) within the sprint working days. */
export function totalLeaveDays(typed: AssigneeLeaves, workingDays: string[]): number {
  const c = leaveDaysByType(typed, workingDays);
  return c.VL + c.EL + c.Holiday + c.Offset;
}

/**
 * Offset earned this sprint — CAPPED AT 1: `(donePoints + leaveDays) >= (N + N2) ? 1 : 0`,
 * where each leave day counts as 1 pt. ADR-038.
 */
export function computeOffsetEarned(
  donePoints: number,
  leaveDays: number,
  requiredPoints: number,
  offsetThreshold: number
): number {
  return donePoints + leaveDays >= requiredPoints + offsetThreshold ? 1 : 0;
}
