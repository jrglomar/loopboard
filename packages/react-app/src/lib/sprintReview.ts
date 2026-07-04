// sprintReview.ts — pure builders for the formatted sprint-review export (v1.38, ADR-048).
// Turns a sprint report + retro form + leaves + offset ledger into (1) a per-member table and
// (2) a printable HTML document. The styled .xlsx renderer lives in sprintReviewXlsx.ts and
// consumes the same model. No side effects; deterministic; unit-tested.

import type { SprintReport, LeaveType } from "./types";
import type { LeavesMap } from "./leavesClient";
import type { OffsetLedger } from "./offsetClient";
import { sprintWorkingDays } from "./capacity";
import { leaveDaysByType } from "./offset";
import { formatPoints } from "./format";
import { buildSprintReviewMeta, type SprintReviewForm } from "./reportMarkdown";

// ── Per-member table ──────────────────────────────────────────────────────────

export interface MemberReviewRow {
  name: string;
  committedPoints: number; // capacity commitment = max(0, requiredPoints − leave days) — NOT assigned tickets
  completedPoints: number; // byAssignee.donePoints
  vl: number;
  el: number;
  holiday: number;
  offset: number;
  leaveTotal: number; // vl + el + holiday + offset (working days)
  offsetBalance: number; // from the offset ledger (cumulative standing)
}

export interface MemberReviewTable {
  rows: MemberReviewRow[];
  totals: {
    committedPoints: number;
    completedPoints: number;
    vl: number;
    el: number;
    holiday: number;
    offset: number;
    leaveTotal: number;
  };
}

/** Sort members alphabetically, but keep "Unassigned" last. */
function byNameUnassignedLast(a: string, b: string): number {
  if (a === "Unassigned") return 1;
  if (b === "Unassigned") return -1;
  return a.localeCompare(b);
}

/**
 * Build the per-member review table. `committedPoints` is a CAPACITY commitment — the required
 * points (N, e.g. 8) minus the member's leave days of every type (VL/EL/Holiday/Offset), floored
 * at 0 — NOT the sum of tickets assigned to them. `completedPoints` is what they actually completed
 * (byAssignee.donePoints). "Unassigned" is not a person, so its commitment is 0. Members are the
 * union of everyone with points, leaves, or an offset standing.
 */
export function buildMemberReviewTable(
  report: SprintReport,
  leaves: LeavesMap | null | undefined,
  ledger: OffsetLedger | null | undefined,
  requiredPoints: number,
  roster: string[] = []
): MemberReviewTable {
  const workingDays = sprintWorkingDays(report.sprint.startDate, report.sprint.endDate);

  // Members = the whole dev roster (so every developer's capacity counts, even with no tickets)
  // ∪ anyone who has points, leaves, or an offset standing.
  const names = new Set<string>();
  for (const n of roster) names.add(n);
  for (const r of report.byAssignee) names.add(r.name);
  for (const n of Object.keys(leaves ?? {})) names.add(n);
  for (const n of Object.keys(ledger ?? {})) names.add(n);

  const rows: MemberReviewRow[] = [...names].sort(byNameUnassignedLast).map((name) => {
    const pts = report.byAssignee.find((r) => r.name === name);
    const counts = leaveDaysByType(leaves?.[name] ?? {}, workingDays);
    const leaveTotal = counts.VL + counts.EL + counts.Holiday + counts.Offset;
    // Capacity commitment: required points − leave days, floored at 0 ("Unassigned" has none).
    const committedPoints = name === "Unassigned" ? 0 : Math.max(0, requiredPoints - leaveTotal);
    return {
      name,
      committedPoints,
      completedPoints: pts?.donePoints ?? 0,
      vl: counts.VL,
      el: counts.EL,
      holiday: counts.Holiday,
      offset: counts.Offset,
      leaveTotal,
      offsetBalance: ledger?.[name]?.balance ?? 0,
    };
  });

  const totals = rows.reduce(
    (t, r) => ({
      committedPoints: t.committedPoints + r.committedPoints,
      completedPoints: t.completedPoints + r.completedPoints,
      vl: t.vl + r.vl,
      el: t.el + r.el,
      holiday: t.holiday + r.holiday,
      offset: t.offset + r.offset,
      leaveTotal: t.leaveTotal + r.leaveTotal,
    }),
    { committedPoints: 0, completedPoints: 0, vl: 0, el: 0, holiday: 0, offset: 0, leaveTotal: 0 }
  );

  return { rows, totals };
}

/** Column headers for the per-member table — shared by the HTML + xlsx renderers. */
export const MEMBER_COLUMNS = [
  "Member",
  "Committed",
  "Completed",
  "VL",
  "EL",
  "Holiday",
  "Offset",
  "Leave days",
  "Offset bal.",
] as const;

/** One member row as display strings, in MEMBER_COLUMNS order. */
export function memberRowCells(r: MemberReviewRow): string[] {
  return [
    r.name,
    formatPoints(r.committedPoints),
    formatPoints(r.completedPoints),
    String(r.vl),
    String(r.el),
    String(r.holiday),
    String(r.offset),
    String(r.leaveTotal),
    r.offsetBalance > 0 ? `+${formatPoints(r.offsetBalance)}` : formatPoints(r.offsetBalance),
  ];
}

/** The TOTAL row as display strings, in MEMBER_COLUMNS order. */
export function memberTotalCells(t: MemberReviewTable["totals"]): string[] {
  return [
    "TOTAL",
    formatPoints(t.committedPoints),
    formatPoints(t.completedPoints),
    String(t.vl),
    String(t.el),
    String(t.holiday),
    String(t.offset),
    String(t.leaveTotal),
    "",
  ];
}

// Which meta fields are long free-text (rendered full-width in the HTML, not in the grid).
const LONG_META = new Set<string>([
  "Reason for delays / incomplete tasks",
  "Fly-ins",
  "What worked well this sprint",
  "What did not work well",
  "Planned improvements for next sprint",
  "Kudos",
]);

// ── Printable HTML ────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Build a standalone, print-ready HTML document for the sprint review. Self-contained styles
 * (no external CSS), A4-friendly, with a title band, a summary grid, the per-member table, and
 * the retro sections. Pure — the caller opens it in a window and triggers print/PDF.
 */
export function buildSprintReviewHtml(
  report: SprintReport,
  form: SprintReviewForm,
  flyIns: string[],
  leaves: LeavesMap | null | undefined,
  ledger: OffsetLedger | null | undefined,
  requiredPoints: number,
  roster: string[] = []
): string {
  const meta = buildSprintReviewMeta(report, form, flyIns);
  const table = buildMemberReviewTable(report, leaves, ledger, requiredPoints, roster);

  const shortMeta = meta.filter(([k]) => !LONG_META.has(k));
  const longMeta = meta.filter(([k]) => LONG_META.has(k));

  const gridRows = shortMeta
    .map(
      ([k, v]) =>
        `<div class="cell"><div class="k">${esc(k)}</div><div class="v">${esc(v || "—")}</div></div>`
    )
    .join("");

  const memberHead = MEMBER_COLUMNS.map(
    (c, i) => `<th class="${i === 0 ? "left" : "num"}">${esc(c)}</th>`
  ).join("");

  const memberBody = table.rows
    .map((r) => {
      const cells = memberRowCells(r)
        .map((c, i) => `<td class="${i === 0 ? "left" : "num"}">${esc(c)}</td>`)
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  const totalRow = memberTotalCells(table.totals)
    .map((c, i) => `<td class="${i === 0 ? "left" : "num"}">${esc(c)}</td>`)
    .join("");

  const longSections = longMeta
    .map(
      ([k, v]) =>
        `<section class="block"><h3>${esc(k)}</h3><p>${esc(v || "—")}</p></section>`
    )
    .join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>Sprint Review — ${esc(report.sprint.name)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Roboto, Arial, sans-serif; color: #1f2937; margin: 0; padding: 24px; background: #fff; }
  .band { background: #1e3a8a; color: #fff; border-radius: 10px; padding: 18px 22px; margin-bottom: 18px; }
  .band h1 { margin: 0 0 4px; font-size: 22px; letter-spacing: .3px; }
  .band .sub { opacity: .9; font-size: 13px; }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: .6px; color: #1e3a8a; border-bottom: 2px solid #e5e7eb; padding-bottom: 5px; margin: 22px 0 12px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 18px; }
  .cell { display: flex; justify-content: space-between; gap: 12px; border-bottom: 1px solid #f1f5f9; padding: 5px 0; font-size: 13px; }
  .cell .k { color: #6b7280; }
  .cell .v { font-weight: 600; text-align: right; }
  table { border-collapse: collapse; width: 100%; font-size: 12.5px; }
  th, td { border: 1px solid #e5e7eb; padding: 6px 9px; }
  th { background: #eef2ff; color: #1e3a8a; text-transform: uppercase; font-size: 10.5px; letter-spacing: .4px; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.left, th.left { text-align: left; }
  tbody tr:nth-child(even) { background: #f8fafc; }
  tfoot td { font-weight: 700; background: #eef2ff; }
  .block { margin: 12px 0; }
  .block h3 { font-size: 12px; color: #374151; margin: 0 0 3px; }
  .block p { margin: 0; font-size: 13px; white-space: pre-wrap; background: #f8fafc; border: 1px solid #eef2f7; border-radius: 6px; padding: 8px 10px; min-height: 20px; }
  .foot { margin-top: 20px; font-size: 10.5px; color: #9ca3af; }
  @media print { body { padding: 0; } .band { border-radius: 0; } @page { margin: 14mm; } }
</style></head>
<body>
  <div class="band">
    <h1>Sprint Review</h1>
    <div class="sub">${esc(report.sprint.name)} · ${esc(sprintDurationOf(meta))}</div>
  </div>

  <h2>Summary</h2>
  <div class="grid">${gridRows}</div>

  <h2>Per-member — points &amp; leaves</h2>
  <table>
    <thead><tr>${memberHead}</tr></thead>
    <tbody>${memberBody || `<tr><td class="left" colspan="${MEMBER_COLUMNS.length}">No member data.</td></tr>`}</tbody>
    <tfoot><tr>${totalRow}</tr></tfoot>
  </table>

  <h2>Retrospective</h2>
  ${longSections}

  <div class="foot">Generated by Loopboard · leave days counted over sprint working days · offset balance is cumulative.</div>
</body></html>`;
}

/** Pull the "Sprint duration" value back out of the meta pairs for the header subtitle. */
function sprintDurationOf(meta: Array<[string, string]>): string {
  return meta.find(([k]) => k === "Sprint duration")?.[1] ?? "";
}

// Re-export the leave-type list origin so callers don't reach past this module.
export type { LeaveType };
