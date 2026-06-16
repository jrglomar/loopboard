// Pure markdown builder for sprint reports — CONTRACTS.md §6, ADR-012, ADR-013
// No side effects; deterministic output; fully unit-tested.
// Used by the export bar (Copy, Download .md, Print).
//
// v1.4.1 (ADR-013): story-points focused — no issue-count metrics in summary or
// by-assignee table; carryover shown as points; formatPoints for all values.
// v1.5 (ADR-016): optional Leaves & capacity section with per-assignee leave days
// and the capacity-adjusted possible committed velocity.

import type { SprintReport, VelocityData } from "./types";
import { formatPoints } from "./format";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  // Take the date portion only (YYYY-MM-DD)
  return iso.slice(0, 10);
}

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

// ── Main builder ──────────────────────────────────────────────────────────────

// ── LeavesCapacity — optional input for the Leaves & capacity section ─────────

/**
 * Per-sprint leaves and capacity data for the Markdown export (v1.5, ADR-016).
 * All fields are optional so callers can provide what's available.
 */
export interface LeavesCapacityData {
  /** Per-assignee leave days (working days off this sprint) */
  byAssigneeLeaveDays: Record<string, number>;
  /** Total leave person-days across the team */
  leavePersonDays: number;
  /** Capacity factor (0–1, 1 when no leaves or no team) */
  capacityFactor: number;
  /** Capacity-adjusted possible committed velocity (= averageCompleted × capacityFactor) */
  possibleCommittedVelocity: number;
  /** Average completed points (baseline for the heuristic) */
  averageCompleted: number;
  /** Number of sprint working days (Mon–Fri) */
  workingDayCount: number;
}

/**
 * Build a clean Markdown document from a sprint report.
 *
 * Sections:
 *  1. Title (sprint name + dates)
 *  2. Goal (if present)
 *  3. Completion summary (points-focused; carryover as points)
 *  4. By-assignee table (points only — name, done pts, total pts; + Leaves col when available)
 *  5. Completed issues list
 *  6. Carryover / not completed list
 *  7. Leaves & capacity section (optional — v1.5, ADR-016)
 *  8. Velocity section (optional — when velocity is provided with sprints)
 *  9. AI summary section (optional)
 *
 * @param report          get_sprint_report output
 * @param velocity        get_velocity output (optional; omitted when null/undefined)
 * @param aiSummary       AI executive summary text (optional; omitted when null/undefined)
 * @param leavesCapacity  v1.5 leaves & capacity data (optional; omitted when null/undefined)
 */
export function buildReportMarkdown(
  report: SprintReport,
  velocity?: VelocityData | null,
  aiSummary?: string | null,
  leavesCapacity?: LeavesCapacityData | null
): string {
  const lines: string[] = [];

  // ── Title ──────────────────────────────────────────────────────────────────
  const start = formatDate(report.sprint.startDate);
  const end = formatDate(report.sprint.endDate);
  lines.push(`# Sprint Report: ${report.sprint.name}`);
  lines.push("");
  lines.push(`**Dates:** ${start} – ${end}  `);
  lines.push(`**State:** ${report.sprint.state}`);
  lines.push("");

  // ── Goal ───────────────────────────────────────────────────────────────────
  if (report.sprint.goal) {
    lines.push(`**Goal:** ${report.sprint.goal}`);
    lines.push("");
  }

  // ── Completion summary (points-focused, ADR-013) ───────────────────────────
  // Carryover points = committed − completed (not issue count)
  const carryoverPoints = report.committedPoints - report.completedPoints;

  lines.push("## Completion Summary");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Committed points | ${formatPoints(report.committedPoints)} |`);
  lines.push(`| Completed points | ${formatPoints(report.completedPoints)} |`);
  lines.push(`| Completion rate | ${pct(report.completionRate)} |`);
  lines.push(`| Carryover points | ${formatPoints(carryoverPoints)} |`);
  if (report.blockedCount > 0) {
    lines.push(`| Blocked | ${report.blockedCount} issues ⚠ |`);
  }
  lines.push("");

  // ── By assignee (points only, ADR-013; + Leaves col when available, ADR-016) ──
  lines.push("## By Assignee");
  lines.push("");
  if (report.byAssignee.length === 0) {
    lines.push("_No assignee data._");
  } else if (leavesCapacity) {
    lines.push("| Assignee | Done pts | Total pts | Leaves |");
    lines.push("|---|---|---|---|");
    for (const row of report.byAssignee) {
      const leaveDays = leavesCapacity.byAssigneeLeaveDays[row.name] ?? 0;
      const leavesStr = leaveDays > 0 ? `${leaveDays} day${leaveDays !== 1 ? "s" : ""}` : "—";
      lines.push(
        `| ${row.name} | ${formatPoints(row.donePoints)} | ${formatPoints(row.totalPoints)} | ${leavesStr} |`
      );
    }
  } else {
    lines.push("| Assignee | Done pts | Total pts |");
    lines.push("|---|---|---|");
    for (const row of report.byAssignee) {
      lines.push(
        `| ${row.name} | ${formatPoints(row.donePoints)} | ${formatPoints(row.totalPoints)} |`
      );
    }
  }
  lines.push("");

  // ── Completed issues ───────────────────────────────────────────────────────
  lines.push("## Completed Issues");
  lines.push("");
  if (report.completed.length === 0) {
    lines.push("_No completed issues._");
  } else {
    for (const issue of report.completed) {
      const pts = issue.storyPoints !== null ? ` (${formatPoints(issue.storyPoints)} pts)` : "";
      const assignee = issue.assignee ? ` — ${issue.assignee}` : "";
      lines.push(
        `- [${issue.key}](${issue.url}) ${issue.summary}${pts}${assignee}`
      );
    }
  }
  lines.push("");

  // ── Carryover / not completed ──────────────────────────────────────────────
  lines.push("## Carryover / Not Completed");
  lines.push("");
  if (report.notCompleted.length === 0) {
    lines.push("_No carryover issues._");
  } else {
    for (const issue of report.notCompleted) {
      const pts = issue.storyPoints !== null ? ` (${formatPoints(issue.storyPoints)} pts)` : "";
      const assignee = issue.assignee ? ` — ${issue.assignee}` : "";
      const blocked = issue.blocked ? " **[BLOCKED]**" : "";
      lines.push(
        `- [${issue.key}](${issue.url}) ${issue.summary}${pts}${assignee}${blocked}`
      );
    }
  }
  lines.push("");

  // ── Leaves & capacity section (optional, v1.5 ADR-016) ───────────────────
  if (leavesCapacity) {
    lines.push("## Leaves & Capacity");
    lines.push("");

    const capacityPct = Math.round(leavesCapacity.capacityFactor * 100);

    if (leavesCapacity.leavePersonDays === 0) {
      lines.push("_No leaves recorded for this sprint._");
    } else {
      lines.push(`Total leave days: ${leavesCapacity.leavePersonDays} working day(s) off`);
      lines.push("");
      // Per-assignee breakdown (only those with leaves), e.g. "- Alice — 2 working day(s) off"
      const perAssignee = Object.entries(leavesCapacity.byAssigneeLeaveDays)
        .filter(([, days]) => days > 0)
        .sort((a, b) => b[1] - a[1]);
      for (const [name, days] of perAssignee) {
        lines.push(`- ${name} — ${days} working day(s) off`);
      }
    }
    lines.push("");

    lines.push(
      `_Possible committed velocity: **${formatPoints(leavesCapacity.possibleCommittedVelocity)} pts** ` +
      `(${formatPoints(leavesCapacity.averageCompleted)} pts avg × ${capacityPct}% capacity, ` +
      `${leavesCapacity.workingDayCount} working day(s) · ` +
      `${leavesCapacity.leavePersonDays} leave day(s) — heuristic, not a commitment)._`
    );
    lines.push("");
  }

  // ── Velocity section (optional) ────────────────────────────────────────────
  if (velocity && velocity.sprints.length > 0) {
    lines.push("## Velocity");
    lines.push("");
    lines.push(
      `_Last ${velocity.sprints.length} closed sprint(s). Average completed: **${formatPoints(velocity.averageCompleted)} pts**. ` +
      `Suggested capacity for next sprint: **${formatPoints(velocity.forecastNext)} pts** ` +
      `(heuristic average — not a commitment)._`
    );
    lines.push("");
    lines.push("| Sprint | Committed | Completed |");
    lines.push("|---|---|---|");
    for (const s of velocity.sprints) {
      lines.push(`| ${s.name} | ${formatPoints(s.committedPoints)} | ${formatPoints(s.completedPoints)} |`);
    }
    lines.push("");
  }

  // ── AI summary section (optional) ─────────────────────────────────────────
  if (aiSummary) {
    lines.push("## AI Executive Summary");
    lines.push("");
    lines.push(aiSummary);
    lines.push("");
  }

  return lines.join("\n");
}
