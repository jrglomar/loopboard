// kpiAdjust.ts — leave-adjusted per-developer KPIs for Trends & KPIs (v1.60, ADR-072). Pure; no
// React, no network. A CLIENT-SIDE join of get_multi_sprint_report × get_all_leaves × the
// per-user offset policy's requiredPoints — no new backend surface (CONTRACTS.md v1.60 item 171).
//
// Capacity convention (ADR-038/048, confirmed with the user; mirrored from lib/capacity.ts's
// computeDevCapacity and lib/offset.ts's computeOffsetEarned): every PLOTTED leave day, of ANY
// type (VL/EL/Holiday/Offset), is worth one point of relief.
//   adjustedTarget = max(0, requiredPoints − leaveDays)
//   met            = donePoints >= adjustedTarget
// A fully-covered sprint (adjustedTarget 0) is "met" even at 0 done points — there was nothing
// left to ask of that developer that sprint.

import type { AllLeavesMap } from "./leavesClient";
import type { MultiSprintReport } from "./types";

export interface DevSprintKpi {
  sprintId: number;
  sprintName: string;
  donePoints: number;
  totalPoints: number;
  leaveDays: number;
  adjustedTarget: number;
  met: boolean;
  /** Had >= 1 issue this sprint (present in that sprint's byAssignee — CONTRACTS.md §4.29). */
  active: boolean;
}

export interface DevKpi {
  name: string;
  /** Chronological — mirrors report.sprints order. */
  perSprint: DevSprintKpi[];
  totals: { donePoints: number; leaveDays: number; adjustedTarget: number };
  metCount: number;
  sprintCount: number;
  /**
   * donePoints / sprintCount over the FULL window (velocity convention — matches
   * MultiSprintAssigneeSummary.avgDonePoints: a quiet/absent sprint still drags the average
   * down, it is NOT donePoints / (sprints the dev was active in)).
   */
  avgDonePoints: number;
}

/**
 * Leave-adjusted per-developer KPIs across a get_multi_sprint_report window.
 *
 * Names = the union of every sprint's byAssignee names ∪ every assignee with a plotted leave in
 * one of the window's sprints. "Unassigned" is a ticket state, not a developer (v1.61, ADR-073,
 * item 176) — excluded from BOTH sides of that union, so it never appears in the developer
 * picker or KPI tiles/exports even when byAssignee itself reports it. A developer who is fully
 * on leave with zero tickets in every sprint of the window still appears (all-zero done/total
 * points).
 *
 * Sorted by totals.donePoints descending, tie → name ascending.
 */
export function computeDevKpis(
  report: MultiSprintReport,
  allLeaves: AllLeavesMap,
  requiredPoints: number
): DevKpi[] {
  const names = new Set<string>();
  for (const entry of report.sprints) {
    for (const a of entry.byAssignee) {
      if (a.name === "Unassigned") continue; // a ticket state, not a developer
      names.add(a.name);
    }
  }
  for (const entry of report.sprints) {
    const leavesForSprint = allLeaves[String(entry.sprint.id)] ?? {};
    for (const name of Object.keys(leavesForSprint)) {
      if (name === "Unassigned") continue; // can't take leave — and not a developer either way
      names.add(name);
    }
  }

  const devKpis: DevKpi[] = [...names].map((name) => {
    const perSprint: DevSprintKpi[] = report.sprints.map((entry) => {
      const match = entry.byAssignee.find((a) => a.name === name);
      const donePoints = match?.donePoints ?? 0;
      const totalPoints = match?.totalPoints ?? 0;

      const leaveDates = allLeaves[String(entry.sprint.id)]?.[name] ?? {};
      const leaveDays = Object.keys(leaveDates).length;
      const adjustedTarget = Math.max(0, requiredPoints - leaveDays);

      return {
        sprintId: entry.sprint.id,
        sprintName: entry.sprint.name,
        donePoints,
        totalPoints,
        leaveDays,
        adjustedTarget,
        met: donePoints >= adjustedTarget,
        active: match !== undefined,
      };
    });

    const totals = perSprint.reduce(
      (acc, s) => ({
        donePoints: acc.donePoints + s.donePoints,
        leaveDays: acc.leaveDays + s.leaveDays,
        adjustedTarget: acc.adjustedTarget + s.adjustedTarget,
      }),
      { donePoints: 0, leaveDays: 0, adjustedTarget: 0 }
    );
    const sprintCount = report.sprintCount;

    return {
      name,
      perSprint,
      totals,
      metCount: perSprint.filter((s) => s.met).length,
      sprintCount,
      avgDonePoints: sprintCount > 0 ? totals.donePoints / sprintCount : 0,
    };
  });

  return devKpis.sort(
    (a, b) => b.totals.donePoints - a.totals.donePoints || a.name.localeCompare(b.name)
  );
}
