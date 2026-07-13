/**
 * Offset-ledger store — per-developer offset-point tracking (v1.26, ADR-038; v1.50 ADR-061; v1.54 ADR-065).
 *
 * Shape: { [assignee]: { bySprint: { [sprintId]: { earned, spent } }, manualAdjust, adjustments? } }
 *  - `earned`/`spent` per sprint are snapshots written by the Leaves page when the user
 *    CONFIRMS banking a sprint (v1.50 — was auto on view). Idempotent upsert per sprint, so
 *    re-banking a sprint never double-counts.
 *  - `manualAdjust` is a single MANUAL absolute delta the user sets directly — the Offset Tracker
 *    surfaces it as each developer's "opening balance" (their prior/carry-in balance).
 *  - `adjustments` (v1.54, ADR-065) is a LOG of ad-hoc manual adjustments — each a signed `amount`
 *    with an optional `note`, added/removed from the Offset History dialog. Distinct from the one-time
 *    opening balance.
 *  - balance(assignee) = Σ earned − Σ spent + manualAdjust + Σ adjustments.amount.
 *
 * Path read from config at call time (getOffsetFilePath()). Reads tolerate a missing/corrupt file.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { getOffsetFilePath } from "./config.js";

export interface OffsetSprintEntry {
  earned: number; // 0 or 1 (capped per sprint)
  spent: number; // Offset-leave days plotted that sprint
}

/** v1.54 (ADR-065) — one ad-hoc manual adjustment to a developer's balance. */
export interface OffsetAdjustment {
  id: string;
  amount: number; // signed, non-zero; DECIMAL-capable (v1.55, ADR-066 — e.g. 0.5)
  note?: string;
  createdAt: string; // ISO
}

export interface AssigneeOffset {
  bySprint: Record<string, OffsetSprintEntry>;
  manualAdjust: number;
  adjustments?: OffsetAdjustment[]; // v1.54 (ADR-065) — optional for back-compat with pre-v1.54 files
}

export type OffsetFile = Record<string, AssigneeOffset>;

/** A flattened, computed view of one developer's offset standing. */
export interface OffsetSummary {
  earned: number; // Σ earned across sprints
  spent: number; // Σ spent across sprints
  manualAdjust: number; // manual delta — surfaced in the UI as the "opening balance"
  balance: number; // earned − spent + manualAdjust + Σ adjustments
  bySprint: Record<string, OffsetSprintEntry>; // per-sprint banked earned/spent (v1.50) — lets the
  // UI show whether a sprint is already banked + plot per-sprint EARNED history (v1.54)
  adjustments: OffsetAdjustment[]; // v1.54 (ADR-065) — the manual-adjustment log, newest-first
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

/** Pure: reduce a ledger to per-assignee computed summaries (earned/spent/manualAdjust/adjustments/balance). */
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
    // v1.54 (ADR-065): the manual-adjustment log — newest-first for the UI; its sum folds into the balance.
    const adjustments = [...(entry.adjustments ?? [])].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const adjTotal = adjustments.reduce((sum, a) => sum + (a.amount ?? 0), 0);
    out[assignee] = {
      earned, spent, manualAdjust, adjustments,
      balance: earned - spent + manualAdjust + adjTotal,
      bySprint: entry.bySprint ?? {},
    };
  }
  return out;
}

/**
 * v1.54 (ADR-065) — APPEND a manual adjustment to a developer's log (mutates + returns the file).
 * Server-assigns the id + createdAt. `note` is trimmed; empty → omitted.
 */
export function addAdjustment(
  file: OffsetFile,
  assignee: string,
  amount: number,
  note?: string
): OffsetFile {
  const cur = file[assignee] ?? { bySprint: {}, manualAdjust: 0 };
  const trimmed = (note ?? "").trim();
  const entry: OffsetAdjustment = {
    id: crypto.randomUUID(),
    amount,
    createdAt: new Date().toISOString(),
    ...(trimmed ? { note: trimmed } : {}),
  };
  cur.adjustments = [...(cur.adjustments ?? []), entry];
  file[assignee] = cur;
  return file;
}

/** v1.54 (ADR-065) — remove a manual adjustment by id (no-op if the assignee/id is absent). */
export function removeAdjustment(file: OffsetFile, assignee: string, id: string): OffsetFile {
  const cur = file[assignee];
  if (cur?.adjustments) cur.adjustments = cur.adjustments.filter((a) => a.id !== id);
  return file;
}
