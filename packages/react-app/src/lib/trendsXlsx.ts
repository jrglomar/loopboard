// trendsXlsx.ts — styled .xlsx renderers for the Trends & KPIs mode (v1.61, ADR-073, item 177).
// Mirrors sprintReviewXlsx.ts's technique exactly (ADR-048): the LAYOUT (cell matrix + row/col
// metadata) is a pure function per sheet so it can be unit-tested without the xlsx library; the
// styling pass is a thin wrapper over xlsx-js-style. TWO separate single-sheet workbooks —
// "Team trends" (export bar) and "Developer KPIs" (DeveloperKpiSection) — rather than one
// combined file, per CONTRACTS.md v1.61 item 177.

import XLSX from "xlsx-js-style";
import type { MultiSprintReport } from "./types";
import type { DevKpi } from "./kpiAdjust";
import { formatPoints } from "./format";

type Cell = string | number;

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

function pctStr(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

// ── Styling constants — same palette as sprintReviewXlsx.ts (ADR-048) ─────────

const NAVY = "1E3A8A";
const INDIGO = "EEF2FF";
const BORDER = "E5E7EB";
// Approximate the app's --success / --error CSS tokens (globals.css) for the Met column —
// "success/error-ish", not a pixel-exact match (an xlsx cell can't consume an HSL CSS var).
const SUCCESS = "1A7F3F";
const ERROR = "DC2828";

const thin = { style: "thin", color: { rgb: BORDER } } as const;
const allBorders = { top: thin, bottom: thin, left: thin, right: thin };

type Merge = { s: { r: number; c: number }; e: { r: number; c: number } };

/** xlsx-js-style returns an ArrayBuffer or Uint8Array for type:"array" — normalize defensively. */
function toArrayBuffer(out: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (out instanceof ArrayBuffer) return out;
  const buf = new ArrayBuffer(out.byteLength);
  new Uint8Array(buf).set(out);
  return buf;
}

// ── Team trends sheet ───────────────────────────────────────────────────────

const TEAM_TRENDS_SHEET_NAME = "Team trends";
const TEAM_TRENDS_COLUMNS = ["Sprint", "Start", "End", "Committed", "Completed", "Rate %", "Carryover", "Blocked"];
const BY_DEVELOPER_COLUMNS = ["Assignee", "Sprints active", "Done pts", "Total pts", "Avg done / sprint"];

export interface TeamTrendsSheet {
  aoa: Cell[][];
  cols: number;
  sheetName: string;
  titleRows: number[];
  headerRow: number;
  firstDataRow: number;
  lastDataRow: number; // inclusive — sprint rows only, excludes TOTAL/AVERAGE
  totalRow: number;
  averageRow: number;
  devSectionTitleRow: number; // "BY DEVELOPER" section title, below AVERAGE + a blank spacer
  devHeaderRow: number; // the BY_DEVELOPER_COLUMNS row
  devFirstDataRow: number;
  devLastDataRow: number; // inclusive; devFirstDataRow − 1 when byAssignee (minus Unassigned) is empty
}

/**
 * Pure layout: one styled row per sprint (chronological — report.sprints' own order), a TOTAL
 * row (sums of committed/completed/carryover/blocked), then an AVERAGE row carrying the report's
 * own averageCompleted (points) and averageCompletionRate (%) — no fabricated "average committed"
 * (the report doesn't compute one). Points are real numbers (Excel can sum them), matching
 * sprintReviewXlsx.ts's member-table convention; the rate columns are pre-formatted percentage
 * text, matching reportMarkdown.ts's pct() convention.
 *
 * Below the AVERAGE row, a BY DEVELOPER section: report.byAssignee, the cross-sprint per-assignee
 * aggregate (§4.29) that markdown/CSV exports already carry, one row per developer. avgDonePoints
 * is the FULL-window average (donePoints / sprintCount), NOT leave-adjusted — the leave-adjusted
 * view lives in the separate Developer KPIs workbook (developerKpisAoa below). "Unassigned" is
 * filtered out (v1.61, ADR-073, item 176 — a ticket state, not a developer). All four numeric
 * columns stay raw numbers, same convention as the sprint rows above.
 */
export function teamTrendsAoa(report: MultiSprintReport, boardLabel: string): TeamTrendsSheet {
  const aoa: Cell[][] = [];

  aoa.push(["TEAM TRENDS"]);
  aoa.push([`${boardLabel} · ${report.sprintCount} sprint${report.sprintCount !== 1 ? "s" : ""}`]);
  const titleRows = [0, 1];
  aoa.push([]); // blank spacer

  const headerRow = aoa.length;
  aoa.push([...TEAM_TRENDS_COLUMNS]);

  const firstDataRow = aoa.length;
  for (const e of report.sprints) {
    aoa.push([
      e.sprint.name,
      formatDate(e.sprint.startDate),
      formatDate(e.sprint.endDate),
      e.committedPoints,
      e.completedPoints,
      pctStr(e.completionRate),
      e.carryoverCount,
      e.blockedCount,
    ]);
  }
  const lastDataRow = report.sprints.length > 0 ? aoa.length - 1 : firstDataRow - 1;

  const totalRow = aoa.length;
  const sumCarryover = report.sprints.reduce((n, e) => n + e.carryoverCount, 0);
  const sumBlocked = report.sprints.reduce((n, e) => n + e.blockedCount, 0);
  aoa.push([
    "TOTAL", "", "", report.totals.committedPoints, report.totals.completedPoints, "", sumCarryover, sumBlocked,
  ]);

  const averageRow = aoa.length;
  aoa.push(["AVERAGE", "", "", "", report.averageCompleted, pctStr(report.averageCompletionRate), "", ""]);

  aoa.push([]); // blank spacer
  const devSectionTitleRow = aoa.length;
  aoa.push(["BY DEVELOPER"]);
  const devHeaderRow = aoa.length;
  aoa.push([...BY_DEVELOPER_COLUMNS]);
  const devFirstDataRow = aoa.length;
  // v1.61 (ADR-073, item 176): "Unassigned" is a ticket state, not a developer — excluded here,
  // same rule as the markdown/CSV by-assignee sections (reportMarkdown.ts).
  const byDeveloper = report.byAssignee.filter((a) => a.name !== "Unassigned");
  for (const a of byDeveloper) {
    aoa.push([a.name, a.sprintsActive, a.donePoints, a.totalPoints, a.avgDonePoints]);
  }
  const devLastDataRow = byDeveloper.length > 0 ? aoa.length - 1 : devFirstDataRow - 1;

  return {
    aoa,
    cols: TEAM_TRENDS_COLUMNS.length,
    sheetName: TEAM_TRENDS_SHEET_NAME,
    titleRows,
    headerRow,
    firstDataRow,
    lastDataRow,
    totalRow,
    averageRow,
    devSectionTitleRow,
    devHeaderRow,
    devFirstDataRow,
    devLastDataRow,
  };
}

/** Render the styled "Team trends" workbook as an .xlsx byte array (for a Blob download). */
export function buildTeamTrendsWorkbook(report: MultiSprintReport, boardLabel: string): ArrayBuffer {
  const layout = teamTrendsAoa(report, boardLabel);
  const ws = XLSX.utils.aoa_to_sheet(layout.aoa);

  const merges: Merge[] = layout.titleRows.map((r) => ({
    s: { r, c: 0 },
    e: { r, c: layout.cols - 1 },
  }));
  merges.push({ s: { r: layout.devSectionTitleRow, c: 0 }, e: { r: layout.devSectionTitleRow, c: layout.cols - 1 } });
  ws["!merges"] = merges;
  ws["!cols"] = [{ wch: 22 }, { wch: 12 }, { wch: 12 }, { wch: 11 }, { wch: 11 }, { wch: 9 }, { wch: 11 }, { wch: 9 }];

  const at = (r: number, c: number) => XLSX.utils.encode_cell({ r, c });
  const styleCell = (r: number, c: number, s: Record<string, unknown>) => {
    const addr = at(r, c);
    if (!ws[addr]) ws[addr] = { t: "s", v: "" };
    ws[addr].s = { ...(ws[addr].s ?? {}), ...s };
  };

  styleCell(layout.titleRows[0]!, 0, {
    font: { bold: true, sz: 18, color: { rgb: "FFFFFF" } },
    fill: { fgColor: { rgb: NAVY } },
    alignment: { horizontal: "left", vertical: "center" },
  });
  styleCell(layout.titleRows[1]!, 0, {
    font: { sz: 11, color: { rgb: "FFFFFF" } },
    fill: { fgColor: { rgb: NAVY } },
  });

  for (let c = 0; c < layout.cols; c++) {
    styleCell(layout.headerRow, c, {
      font: { bold: true, color: { rgb: NAVY } },
      fill: { fgColor: { rgb: INDIGO } },
      border: allBorders,
      alignment: { horizontal: c === 0 ? "left" : "right" },
    });
  }
  for (let r = layout.firstDataRow; r <= layout.averageRow; r++) {
    const isSummary = r === layout.totalRow || r === layout.averageRow;
    for (let c = 0; c < layout.cols; c++) {
      styleCell(r, c, {
        border: allBorders,
        alignment: { horizontal: c === 0 ? "left" : "right" },
        ...(isSummary ? { font: { bold: true }, fill: { fgColor: { rgb: INDIGO } } } : {}),
      });
    }
  }

  // BY DEVELOPER section — styled separately since it only spans BY_DEVELOPER_COLUMNS.length
  // (5) columns, narrower than the sprint table's layout.cols (8). Section title mirrors the
  // Developer-KPIs workbook's per-dev block header (buildDeveloperKpisWorkbook's b.headerRow);
  // the header/data rows mirror this sheet's own header/data styling above.
  styleCell(layout.devSectionTitleRow, 0, {
    font: { bold: true, sz: 12, color: { rgb: NAVY } },
    fill: { fgColor: { rgb: INDIGO } },
  });
  for (let c = 0; c < BY_DEVELOPER_COLUMNS.length; c++) {
    styleCell(layout.devHeaderRow, c, {
      font: { bold: true, color: { rgb: NAVY } },
      fill: { fgColor: { rgb: INDIGO } },
      border: allBorders,
      alignment: { horizontal: c === 0 ? "left" : "right" },
    });
  }
  for (let r = layout.devFirstDataRow; r <= layout.devLastDataRow; r++) {
    for (let c = 0; c < BY_DEVELOPER_COLUMNS.length; c++) {
      styleCell(r, c, {
        border: allBorders,
        alignment: { horizontal: c === 0 ? "left" : "right" },
      });
    }
  }

  const out = XLSX.write(
    { SheetNames: [layout.sheetName], Sheets: { [layout.sheetName]: ws } },
    { type: "array", bookType: "xlsx" }
  ) as ArrayBuffer | Uint8Array;
  return toArrayBuffer(out);
}

// ── Developer KPIs sheet ────────────────────────────────────────────────────

const DEV_KPIS_SHEET_NAME = "Developer KPIs";
const DEV_KPIS_COLUMNS = ["Sprint", "Done", "Total", "Leaves (d)", "Target (adj)", "Met"];

export interface DevKpiBlock {
  name: string;
  headerRow: number; // "Name — avg done X · met N of M sprints"
  subHeaderRow: number; // the DEV_KPIS_COLUMNS row
  firstDataRow: number;
  lastDataRow: number; // inclusive; < firstDataRow when the dev has zero sprints in perSprint
}

export interface DeveloperKpisSheet {
  aoa: Cell[][];
  cols: number;
  sheetName: string;
  titleRows: number[];
  /** One block per dev, in the SAME order as the input devKpis (kpiAdjust's donePoints-desc sort;
   *  "Unassigned" is never present — kpiAdjust.ts excludes it from both sides of the union). */
  blocks: DevKpiBlock[];
}

/**
 * Pure layout: a bold dev header row + a column sub-header + one row per sprint, per developer,
 * separated by a blank spacer row. Met is rendered as the TEXT "Yes"/"No" (styled at the byte
 * layer) rather than a boolean so it reads naturally in a spreadsheet cell.
 */
export function developerKpisAoa(devKpis: DevKpi[], boardLabel: string): DeveloperKpisSheet {
  const aoa: Cell[][] = [];

  aoa.push(["DEVELOPER KPIS"]);
  aoa.push([`${boardLabel} · ${devKpis.length} developer${devKpis.length !== 1 ? "s" : ""}`]);
  const titleRows = [0, 1];
  aoa.push([]); // blank spacer

  const blocks: DevKpiBlock[] = [];
  for (const dev of devKpis) {
    const headerRow = aoa.length;
    aoa.push([
      `${dev.name} — avg done ${formatPoints(dev.avgDonePoints)} · met ${dev.metCount} of ${dev.sprintCount} sprints`,
    ]);
    const subHeaderRow = aoa.length;
    aoa.push([...DEV_KPIS_COLUMNS]);
    const firstDataRow = aoa.length;
    for (const s of dev.perSprint) {
      aoa.push([s.sprintName, s.donePoints, s.totalPoints, s.leaveDays, s.adjustedTarget, s.met ? "Yes" : "No"]);
    }
    const lastDataRow = dev.perSprint.length > 0 ? aoa.length - 1 : firstDataRow - 1;
    aoa.push([]); // blank spacer between devs
    blocks.push({ name: dev.name, headerRow, subHeaderRow, firstDataRow, lastDataRow });
  }

  return { aoa, cols: DEV_KPIS_COLUMNS.length, sheetName: DEV_KPIS_SHEET_NAME, titleRows, blocks };
}

/** Render the styled "Developer KPIs" workbook as an .xlsx byte array (for a Blob download). */
export function buildDeveloperKpisWorkbook(devKpis: DevKpi[], boardLabel: string): ArrayBuffer {
  const layout = developerKpisAoa(devKpis, boardLabel);
  const ws = XLSX.utils.aoa_to_sheet(layout.aoa);

  const merges: Merge[] = layout.titleRows.map((r) => ({ s: { r, c: 0 }, e: { r, c: layout.cols - 1 } }));
  for (const b of layout.blocks) {
    merges.push({ s: { r: b.headerRow, c: 0 }, e: { r: b.headerRow, c: layout.cols - 1 } });
  }
  ws["!merges"] = merges;
  ws["!cols"] = [{ wch: 22 }, { wch: 8 }, { wch: 8 }, { wch: 11 }, { wch: 12 }, { wch: 7 }];

  const at = (r: number, c: number) => XLSX.utils.encode_cell({ r, c });
  const styleCell = (r: number, c: number, s: Record<string, unknown>) => {
    const addr = at(r, c);
    if (!ws[addr]) ws[addr] = { t: "s", v: "" };
    ws[addr].s = { ...(ws[addr].s ?? {}), ...s };
  };

  styleCell(layout.titleRows[0]!, 0, {
    font: { bold: true, sz: 18, color: { rgb: "FFFFFF" } },
    fill: { fgColor: { rgb: NAVY } },
    alignment: { horizontal: "left", vertical: "center" },
  });
  styleCell(layout.titleRows[1]!, 0, {
    font: { sz: 11, color: { rgb: "FFFFFF" } },
    fill: { fgColor: { rgb: NAVY } },
  });

  const metCol = layout.cols - 1;
  for (const b of layout.blocks) {
    styleCell(b.headerRow, 0, {
      font: { bold: true, sz: 12, color: { rgb: NAVY } },
      fill: { fgColor: { rgb: INDIGO } },
    });
    for (let c = 0; c < layout.cols; c++) {
      styleCell(b.subHeaderRow, c, {
        font: { bold: true, color: { rgb: NAVY } },
        fill: { fgColor: { rgb: INDIGO } },
        border: allBorders,
        alignment: { horizontal: c === 0 ? "left" : "right" },
      });
    }
    for (let r = b.firstDataRow; r <= b.lastDataRow; r++) {
      for (let c = 0; c < layout.cols; c++) {
        styleCell(r, c, {
          border: allBorders,
          alignment: { horizontal: c === 0 ? "left" : "right" },
        });
      }
      // Met column — success/error-ish text color; anything else (there is no "anything else"
      // today — met is always Yes/No) stays plain per the border/alignment pass above.
      const metVal = ws[at(r, metCol)]?.v;
      if (metVal === "Yes") {
        styleCell(r, metCol, { font: { bold: true, color: { rgb: SUCCESS } } });
      } else if (metVal === "No") {
        styleCell(r, metCol, { font: { bold: true, color: { rgb: ERROR } } });
      }
    }
  }

  const out = XLSX.write(
    { SheetNames: [layout.sheetName], Sheets: { [layout.sheetName]: ws } },
    { type: "array", bookType: "xlsx" }
  ) as ArrayBuffer | Uint8Array;
  return toArrayBuffer(out);
}
