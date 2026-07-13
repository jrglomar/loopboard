// offsetWallet.ts (v1.33, ADR-044) — pure offset "wallet" computation.
//
// The main offset tracker: each developer has a running balance.
//   • SPEND is derived LIVE from Offset-type leaves (get_all_leaves) — plotting an Offset leave
//     immediately lowers the balance; un-plotting raises it. (Uses the leaves store as the source of truth.)
//   • EARNED comes from the banked ledger (auto-recorded per sprint on the Offset Tracker page).
//   • balance = earned − spent + manual.
// Uses ONLY `earned` + `manualAdjust` from the ledger (never its stored `spent`/`balance`).
// No React, no network.

import type { OffsetLedger } from "./offsetClient";
import type { AllLeavesMap } from "./leavesClient";
import type { OffsetAdjustment } from "./types";

export interface OffsetWalletEntry {
  earned: number; // Σ banked earned across sprints (from the ledger)
  spent: number; // Σ Offset-type leave days plotted (derived, live)
  manual: number; // the single manual "opening balance" adjustment
  adjustmentsTotal: number; // v1.54 (ADR-065): Σ of the manual-adjustment log
  balance: number; // earned − spent + manual + adjustmentsTotal
}

/** Count each assignee's plotted Offset-type leave days across every sprint. */
export function countOffsetLeaves(allLeaves: AllLeavesMap): Record<string, number> {
  const out: Record<string, number> = {};
  for (const byAssignee of Object.values(allLeaves)) {
    for (const [assignee, dates] of Object.entries(byAssignee)) {
      for (const type of Object.values(dates)) {
        if (type === "Offset") out[assignee] = (out[assignee] ?? 0) + 1;
      }
    }
  }
  return out;
}

/**
 * The offset wallet per developer: earned (banked) − spent (derived from Offset leaves) + manual.
 * Includes anyone present in either source (so a spend with no prior earn shows a negative balance).
 */
export function computeOffsetWallet(
  ledger: OffsetLedger | null | undefined,
  allLeaves: AllLeavesMap
): Record<string, OffsetWalletEntry> {
  const spentByAssignee = countOffsetLeaves(allLeaves);
  const names = new Set<string>([...Object.keys(ledger ?? {}), ...Object.keys(spentByAssignee)]);

  const out: Record<string, OffsetWalletEntry> = {};
  for (const name of names) {
    const earned = ledger?.[name]?.earned ?? 0;
    const manual = ledger?.[name]?.manualAdjust ?? 0;
    const spent = spentByAssignee[name] ?? 0;
    // v1.54 (ADR-065): fold the manual-adjustment log into the balance.
    const adjustmentsTotal = (ledger?.[name]?.adjustments ?? []).reduce((s, a) => s + (a.amount ?? 0), 0);
    out[name] = { earned, spent, manual, adjustmentsTotal, balance: earned - spent + manual + adjustmentsTotal };
  }
  return out;
}

// ── History (v1.33, ADR-044 — Phase 2) ────────────────────────────────────────

/** One offset USAGE event — an Offset leave the developer plotted (a spend). */
export interface OffsetUsage {
  date: string; // YYYY-MM-DD
  sprintId: number;
  sprintName?: string;
}

/** v1.54 (ADR-065): one sprint's banked EARNED points (for the earned-history section). */
export interface OffsetEarned {
  sprintId: number;
  sprintName?: string;
  earned: number;
}

export interface OffsetHistory extends OffsetWalletEntry {
  /** Each Offset leave (spend), newest first. */
  usage: OffsetUsage[];
  /** v1.54: each sprint that banked earned points, newest sprint first. */
  earnedBySprint: OffsetEarned[];
  /** v1.54: the manual-adjustment log (newest first, as returned by the ledger). */
  adjustments: OffsetAdjustment[];
}

/**
 * One developer's offset standing + full history: `usage` (every Offset leave spend, dated), plus (v1.54)
 * `earnedBySprint` (each sprint's banked earned, from the ledger `bySprint`) and `adjustments` (the manual
 * adjustment log). All feed the Offset History dialog.
 */
export function buildOffsetHistory(
  assignee: string,
  ledger: OffsetLedger | null | undefined,
  allLeaves: AllLeavesMap,
  sprintNameById?: Record<string, string>
): OffsetHistory {
  const wallet = computeOffsetWallet(ledger, allLeaves)[assignee]
    ?? { earned: 0, spent: 0, manual: 0, adjustmentsTotal: 0, balance: 0 };

  const usage: OffsetUsage[] = [];
  for (const [sprintId, byAssignee] of Object.entries(allLeaves)) {
    const dates = byAssignee[assignee];
    if (!dates) continue;
    for (const [date, type] of Object.entries(dates)) {
      if (type === "Offset") usage.push({ date, sprintId: Number(sprintId), sprintName: sprintNameById?.[sprintId] });
    }
  }
  usage.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // newest first

  // v1.54: banked earned per sprint (only sprints that earned > 0), newest sprint (highest id) first.
  const earnedBySprint: OffsetEarned[] = Object.entries(ledger?.[assignee]?.bySprint ?? {})
    .filter(([, v]) => (v.earned ?? 0) > 0)
    .map(([sprintId, v]) => ({ sprintId: Number(sprintId), sprintName: sprintNameById?.[sprintId], earned: v.earned }))
    .sort((a, b) => b.sprintId - a.sprintId);

  const adjustments = ledger?.[assignee]?.adjustments ?? []; // backend returns newest-first

  return { ...wallet, usage, earnedBySprint, adjustments };
}
