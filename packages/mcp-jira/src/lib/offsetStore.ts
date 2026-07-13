/**
 * Offset-ledger store — per-developer offset-point tracking (v1.26, ADR-038; v1.50 ADR-061).
 *
 * Shape: { [assignee]: { bySprint: { [sprintId]: { earned, spent } }, manualAdjust } }
 *  - `earned`/`spent` per sprint are snapshots written by the Leaves page when the user
 *    CONFIRMS banking a sprint (v1.50 — was auto on view). Idempotent upsert per sprint, so
 *    re-banking a sprint never double-counts.
 *  - `manualAdjust` is a MANUAL absolute delta the user sets directly — the Offset Tracker surfaces
 *    it as each developer's "opening balance" (their prior/carry-in balance).
 *  - balance(assignee) = Σ earned − Σ spent + manualAdjust.
 *
 * Path read from config at call time (getOffsetFilePath()). Reads tolerate a missing/corrupt file.
 */

import * as fs from "fs";
import * as path from "path";
import { getOffsetFilePath } from "./config.js";

export interface OffsetSprintEntry {
  earned: number; // 0 or 1 (capped per sprint)
  spent: number; // Offset-leave days plotted that sprint
}

export interface AssigneeOffset {
  bySprint: Record<string, OffsetSprintEntry>;
  manualAdjust: number;
}

export type OffsetFile = Record<string, AssigneeOffset>;

/** A flattened, computed view of one developer's offset standing. */
export interface OffsetSummary {
  earned: number; // Σ earned across sprints
  spent: number; // Σ spent across sprints
  manualAdjust: number; // manual delta — surfaced in the UI as the "opening balance"
  balance: number; // earned − spent + manualAdjust
  bySprint: Record<string, OffsetSprintEntry>; // per-sprint banked earned/spent (v1.50) — lets the
  // UI show whether a sprint is already banked
}

export function readOffset(): OffsetFile {
  const filePath = getOffsetFilePath();
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as OffsetFile;
  } catch {
    return {};
  }
}

export function writeOffset(data: OffsetFile): void {
  const filePath = getOffsetFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

/** Pure: reduce a ledger to per-assignee computed summaries (earned/spent/manualAdjust/balance). */
export function summarizeOffset(file: OffsetFile): Record<string, OffsetSummary> {
  const out: Record<string, OffsetSummary> = {};
  for (const [assignee, entry] of Object.entries(file)) {
    let earned = 0;
    let spent = 0;
    for (const s of Object.values(entry.bySprint ?? {})) {
      earned += s.earned ?? 0;
      spent += s.spent ?? 0;
    }
    const manualAdjust = entry.manualAdjust ?? 0;
    out[assignee] = {
      earned, spent, manualAdjust,
      balance: earned - spent + manualAdjust,
      bySprint: entry.bySprint ?? {},
    };
  }
  return out;
}
