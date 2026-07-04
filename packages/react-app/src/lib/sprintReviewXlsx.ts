// sprintReviewXlsx.ts — styled .xlsx renderer for the sprint review (v1.38, ADR-048).
// The LAYOUT (cell matrix + which rows are title/section/table/field) is a pure function so it
// can be unit-tested without the library; the styling pass is a thin wrapper over xlsx-js-style.

import XLSX from "xlsx-js-style";
import type { SprintReport } from "./types";
import type { LeavesMap } from "./leavesClient";
import type { OffsetLedger } from "./offsetClient";
import { buildSprintReviewMeta, type SprintReviewForm } from "./reportMarkdown";
import { buildMemberReviewTable, MEMBER_COLUMNS } from "./sprintReview";

type Cell = string | number;

export interface SprintReviewSheet {
  aoa: Cell[][];
  cols: number;
  /** Merge ranges in xlsx {s,e} row/col form. */
  merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }>;
  titleRows: number[]; // banded title + subtitle
  sectionRows: number[]; // section headers
  memberHeaderRow: number; // the member table's column-header row
  memberFirstDataRow: number;
  memberLastDataRow: number; // inclusive (excludes the TOTAL row)
  totalRow: number;
  fieldRows: number[]; // [Field, Value] rows — Field cell styled as a label
}

const LONG_META = new Set<string>([
  "Reason for delays / incomplete tasks",
  "Fly-ins",
  "What worked well this sprint",
  "What did not work well",
  "Planned improvements for next sprint",
  "Kudos",
]);

const COLS = MEMBER_COLUMNS.length; // 9 — the widest block drives the merge width

/**
 * Pure layout: build the cell matrix + row/merge metadata for the sprint-review workbook.
 * Member numeric columns are real numbers (so Excel can sum them); everything else is text.
 */
export function sprintReviewAoa(
  report: SprintReport,
  form: SprintReviewForm,
  flyIns: string[],
  leaves: LeavesMap | null | undefined,
  ledger: OffsetLedger | null | undefined,
  requiredPoints: number,
  roster: string[] = []
): SprintReviewSheet {
  const meta = buildSprintReviewMeta(report, form, flyIns);
  const table = buildMemberReviewTable(report, leaves, ledger, requiredPoints, roster);
  const short = meta.filter(([k]) => !LONG_META.has(k));
  const long = meta.filter(([k]) => LONG_META.has(k));

  const aoa: Cell[][] = [];
  const merges: SprintReviewSheet["merges"] = [];
  const sectionRows: number[] = [];
  const fieldRows: number[] = [];
  const blank = (): Cell[] => [];
  const full = (r: number) => merges.push({ s: { r, c: 0 }, e: { r, c: COLS - 1 } });
  const valueSpan = (r: number) => merges.push({ s: { r, c: 1 }, e: { r, c: COLS - 1 } });

  // Title band
  aoa.push(["SPRINT REVIEW"]); full(0);
  const subtitle =
    `${report.sprint.name} · ${meta.find(([k]) => k === "Sprint duration")?.[1] ?? ""}`;
  aoa.push([subtitle]); full(1);
  const titleRows = [0, 1];
  aoa.push(blank());

  // Summary section (short meta as Field/Value)
  let r = aoa.length;
  aoa.push(["Summary"]); full(r); sectionRows.push(r);
  for (const [k, v] of short) {
    r = aoa.length;
    aoa.push([k, v || "—"]);
    valueSpan(r);
    fieldRows.push(r);
  }
  aoa.push(blank());

  // Per-member section
  r = aoa.length;
  aoa.push(["Per-member — points & leaves"]); full(r); sectionRows.push(r);
  const memberHeaderRow = aoa.length;
  aoa.push([...MEMBER_COLUMNS]);
  const memberFirstDataRow = aoa.length;
  for (const m of table.rows) {
    aoa.push([
      m.name, m.committedPoints, m.completedPoints, m.vl, m.el, m.holiday, m.offset, m.leaveTotal,
      m.offsetBalance,
    ]);
  }
  const memberLastDataRow = table.rows.length > 0 ? aoa.length - 1 : memberFirstDataRow - 1;
  const totalRow = aoa.length;
  const t = table.totals;
  aoa.push(["TOTAL", t.committedPoints, t.completedPoints, t.vl, t.el, t.holiday, t.offset, t.leaveTotal, ""]);
  aoa.push(blank());

  // Retrospective section (long meta as Field/Value with wide value)
  r = aoa.length;
  aoa.push(["Retrospective"]); full(r); sectionRows.push(r);
  for (const [k, v] of long) {
    r = aoa.length;
    aoa.push([k, v || "—"]);
    valueSpan(r);
    fieldRows.push(r);
  }

  return {
    aoa, cols: COLS, merges, titleRows, sectionRows,
    memberHeaderRow, memberFirstDataRow, memberLastDataRow, totalRow, fieldRows,
  };
}

// ── Styling ───────────────────────────────────────────────────────────────────

const NAVY = "1E3A8A";
const INDIGO = "EEF2FF";
const GREY = "6B7280";
const BORDER = "E5E7EB";

const thin = { style: "thin", color: { rgb: BORDER } } as const;
const allBorders = { top: thin, bottom: thin, left: thin, right: thin };

/**
 * Render the styled workbook as an .xlsx byte array (for a Blob download). Applies the title band,
 * section headers, member-table borders, and a bold TOTAL row over the pure layout above.
 */
export function sprintReviewXlsxArray(
  report: SprintReport,
  form: SprintReviewForm,
  flyIns: string[],
  leaves: LeavesMap | null | undefined,
  ledger: OffsetLedger | null | undefined,
  requiredPoints: number,
  roster: string[] = []
): ArrayBuffer {
  const layout = sprintReviewAoa(report, form, flyIns, leaves, ledger, requiredPoints, roster);
  const ws = XLSX.utils.aoa_to_sheet(layout.aoa);

  ws["!merges"] = layout.merges;
  ws["!cols"] = [{ wch: 34 }, { wch: 12 }, { wch: 12 }, { wch: 6 }, { wch: 6 }, { wch: 8 }, { wch: 8 }, { wch: 11 }, { wch: 11 }];

  const at = (r: number, c: number) => XLSX.utils.encode_cell({ r, c });
  const styleCell = (r: number, c: number, s: Record<string, unknown>) => {
    const addr = at(r, c);
    if (!ws[addr]) ws[addr] = { t: "s", v: "" };
    ws[addr].s = { ...(ws[addr].s ?? {}), ...s };
  };

  // Title band (row 0) + subtitle (row 1)
  styleCell(layout.titleRows[0]!, 0, {
    font: { bold: true, sz: 18, color: { rgb: "FFFFFF" } },
    fill: { fgColor: { rgb: NAVY } },
    alignment: { horizontal: "left", vertical: "center" },
  });
  styleCell(layout.titleRows[1]!, 0, {
    font: { sz: 11, color: { rgb: "FFFFFF" } },
    fill: { fgColor: { rgb: NAVY } },
  });

  // Section headers
  for (const r of layout.sectionRows) {
    styleCell(r, 0, {
      font: { bold: true, sz: 12, color: { rgb: NAVY } },
      fill: { fgColor: { rgb: INDIGO } },
    });
  }

  // Field/Value rows — bold-grey label
  for (const r of layout.fieldRows) {
    styleCell(r, 0, { font: { bold: true, color: { rgb: GREY } }, alignment: { vertical: "top" } });
    styleCell(r, 1, { alignment: { wrapText: true, vertical: "top" } });
  }

  // Member table — header + body + total, all bordered
  for (let c = 0; c < layout.cols; c++) {
    styleCell(layout.memberHeaderRow, c, {
      font: { bold: true, color: { rgb: NAVY } },
      fill: { fgColor: { rgb: INDIGO } },
      border: allBorders,
      alignment: { horizontal: c === 0 ? "left" : "right" },
    });
  }
  for (let r = layout.memberFirstDataRow; r <= layout.totalRow; r++) {
    const isTotal = r === layout.totalRow;
    for (let c = 0; c < layout.cols; c++) {
      styleCell(r, c, {
        border: allBorders,
        alignment: { horizontal: c === 0 ? "left" : "right" },
        ...(isTotal ? { font: { bold: true }, fill: { fgColor: { rgb: INDIGO } } } : {}),
      });
    }
  }

  // xlsx-js-style returns an ArrayBuffer for type:"array"; normalize defensively either way.
  const out = XLSX.write(
    { SheetNames: ["Sprint Review"], Sheets: { "Sprint Review": ws } },
    { type: "array", bookType: "xlsx" }
  ) as ArrayBuffer | Uint8Array;
  if (out instanceof ArrayBuffer) return out;
  const u8 = out as Uint8Array;
  const buf = new ArrayBuffer(u8.byteLength);
  new Uint8Array(buf).set(u8);
  return buf;
}
