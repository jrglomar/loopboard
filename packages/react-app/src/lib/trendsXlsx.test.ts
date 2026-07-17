// trendsXlsx.ts — styled Trends & KPIs workbook layouts (v1.61, ADR-073, item 177). The AoA
// layouts are pure (structure-level, mirrors sprintReviewXlsx.test.ts); the byte output is
// smoke-checked (non-empty ArrayBuffer, correct sheet name via XLSX.read). Keyless/offline.

import { describe, it, expect } from "vitest";
import XLSX from "xlsx-js-style";
import {
  teamTrendsAoa, buildTeamTrendsWorkbook, developerKpisAoa, buildDeveloperKpisWorkbook,
} from "./trendsXlsx";
import type { MultiSprintReport } from "./types";
import type { DevKpi } from "./kpiAdjust";

const REPORT: MultiSprintReport = {
  boardId: 1,
  sprintCount: 2,
  sprints: [
    {
      sprint: {
        id: 50, name: "Sprint 4", state: "closed",
        startDate: "2026-04-01T00:00:00.000Z", endDate: "2026-04-14T00:00:00.000Z",
        completeDate: "2026-04-14T17:00:00.000Z", goal: null, boardId: 1,
      },
      committedPoints: 30, completedPoints: 28, completionRate: 0.9333333,
      totalCount: 8, completedCount: 7, carryoverCount: 1, blockedCount: 0,
      byAssignee: [{ name: "Alice", donePoints: 18, totalPoints: 20, doneCount: 4, totalCount: 5 }],
    },
    {
      sprint: {
        id: 54, name: "Sprint 6", state: "closed",
        startDate: "2026-05-12T00:00:00.000Z", endDate: "2026-05-25T00:00:00.000Z",
        completeDate: "2026-05-25T17:00:00.000Z", goal: "Ship auth flow", boardId: 1,
      },
      committedPoints: 40, completedPoints: 32, completionRate: 0.8,
      totalCount: 10, completedCount: 8, carryoverCount: 2, blockedCount: 1,
      byAssignee: [{ name: "Alice", donePoints: 8, totalPoints: 13, doneCount: 1, totalCount: 2 }],
    },
  ],
  totals: { committedPoints: 70, completedPoints: 60 },
  averageCompleted: 30,
  averageCompletionRate: 0.8666665,
  byAssignee: [
    { name: "Alice", sprintsActive: 2, donePoints: 26, totalPoints: 33, avgDonePoints: 13 },
    { name: "Bob", sprintsActive: 1, donePoints: 7, totalPoints: 10, avgDonePoints: 3.5 },
    { name: "Unassigned", sprintsActive: 2, donePoints: 4, totalPoints: 9, avgDonePoints: 2 },
  ],
};

const EMPTY_REPORT: MultiSprintReport = {
  boardId: 1, sprintCount: 0, sprints: [],
  totals: { committedPoints: 0, completedPoints: 0 },
  averageCompleted: 0, averageCompletionRate: 0, byAssignee: [],
};

const DEV_KPIS: DevKpi[] = [
  {
    name: "Alice",
    perSprint: [
      { sprintId: 50, sprintName: "Sprint 4", donePoints: 8, totalPoints: 8, leaveDays: 0, adjustedTarget: 8, met: true, active: true },
      { sprintId: 54, sprintName: "Sprint 6", donePoints: 1, totalPoints: 5, leaveDays: 2, adjustedTarget: 6, met: false, active: true },
    ],
    totals: { donePoints: 9, leaveDays: 2, adjustedTarget: 14 },
    metCount: 1,
    sprintCount: 2,
    avgDonePoints: 4.5,
  },
  {
    name: "Bob",
    perSprint: [
      { sprintId: 50, sprintName: "Sprint 4", donePoints: 8, totalPoints: 8, leaveDays: 0, adjustedTarget: 8, met: true, active: true },
      { sprintId: 54, sprintName: "Sprint 6", donePoints: 8, totalPoints: 8, leaveDays: 0, adjustedTarget: 8, met: true, active: true },
    ],
    totals: { donePoints: 16, leaveDays: 0, adjustedTarget: 16 },
    metCount: 2,
    sprintCount: 2,
    avgDonePoints: 8,
  },
];

describe("teamTrendsAoa (layout)", () => {
  const layout = teamTrendsAoa(REPORT, "Dev");

  it("uses the exact sheet name 'Team trends'", () => {
    expect(layout.sheetName).toBe("Team trends");
  });

  it("bands the title with the board label and sprint count", () => {
    expect(layout.aoa[layout.titleRows[0]!]![0]).toBe("TEAM TRENDS");
    expect(String(layout.aoa[layout.titleRows[1]!]![0])).toContain("Dev");
    expect(String(layout.aoa[layout.titleRows[1]!]![0])).toContain("2 sprints");
  });

  it("has the exact header row", () => {
    expect(layout.aoa[layout.headerRow]).toEqual([
      "Sprint", "Start", "End", "Committed", "Completed", "Rate %", "Carryover", "Blocked",
    ]);
  });

  it("writes one row per sprint, chronological, points as real numbers", () => {
    expect(layout.lastDataRow - layout.firstDataRow + 1).toBe(2);
    const s1 = layout.aoa[layout.firstDataRow]!;
    expect(s1).toEqual(["Sprint 4", "2026-04-01", "2026-04-14", 30, 28, "93%", 1, 0]);
    const s2 = layout.aoa[layout.firstDataRow + 1]!;
    expect(s2).toEqual(["Sprint 6", "2026-05-12", "2026-05-25", 40, 32, "80%", 2, 1]);
  });

  it("ends with a TOTAL row (sums) then an AVERAGE row (averageCompleted, averageCompletionRate)", () => {
    expect(layout.totalRow).toBe(layout.lastDataRow + 1);
    expect(layout.aoa[layout.totalRow]).toEqual(["TOTAL", "", "", 70, 60, "", 3, 1]);

    expect(layout.averageRow).toBe(layout.totalRow + 1);
    expect(layout.aoa[layout.averageRow]).toEqual(["AVERAGE", "", "", "", 30, "87%", "", ""]);
  });

  it("row count = 2 title rows + 1 blank + 1 header + N sprint rows + TOTAL + AVERAGE + BY DEVELOPER (blank + title + header + M dev rows)", () => {
    const byDeveloperCount = REPORT.byAssignee.filter((a) => a.name !== "Unassigned").length;
    expect(layout.aoa.length).toBe(2 + 1 + 1 + REPORT.sprints.length + 1 + 1 + 1 + 1 + 1 + byDeveloperCount);
  });

  it("handles an empty window without throwing (no sprint rows, totals all zero)", () => {
    const empty = teamTrendsAoa(EMPTY_REPORT, "Dev");
    expect(empty.lastDataRow).toBeLessThan(empty.firstDataRow);
    expect(empty.aoa[empty.totalRow]).toEqual(["TOTAL", "", "", 0, 0, "", 0, 0]);
    expect(empty.aoa[empty.averageRow]).toEqual(["AVERAGE", "", "", "", 0, "0%", "", ""]);
  });

  // v1.62 (ADR-074, item 180): BY DEVELOPER section below AVERAGE.
  it("adds a BY DEVELOPER section title one blank row after AVERAGE, with the exact 5-column header", () => {
    expect(layout.devSectionTitleRow).toBe(layout.averageRow + 2); // AVERAGE row + 1 blank spacer
    expect(layout.aoa[layout.devSectionTitleRow]).toEqual(["BY DEVELOPER"]);
    expect(layout.devHeaderRow).toBe(layout.devSectionTitleRow + 1);
    expect(layout.aoa[layout.devHeaderRow]).toEqual([
      "Assignee", "Sprints active", "Done pts", "Total pts", "Avg done / sprint",
    ]);
  });

  it("writes one BY DEVELOPER row per assignee in byAssignee order, raw numeric values (decimal avg included)", () => {
    expect(layout.devFirstDataRow).toBe(layout.devHeaderRow + 1);
    expect(layout.devLastDataRow).toBe(layout.devFirstDataRow + 1); // Alice + Bob; Unassigned filtered
    expect(layout.aoa[layout.devFirstDataRow]).toEqual(["Alice", 2, 26, 33, 13]);
    expect(layout.aoa[layout.devFirstDataRow + 1]).toEqual(["Bob", 1, 7, 10, 3.5]);
  });

  it("filters 'Unassigned' out of the BY DEVELOPER section even though the fixture's byAssignee includes it", () => {
    expect(REPORT.byAssignee.map((a) => a.name)).toContain("Unassigned"); // fixture sanity check
    const flat = layout.aoa.flat().map(String);
    expect(flat).not.toContain("Unassigned");
    expect(flat.some((c) => c.includes("Unassigned"))).toBe(false);
  });

  it("handles an empty byAssignee list in the BY DEVELOPER section (no dev rows)", () => {
    const empty = teamTrendsAoa(EMPTY_REPORT, "Dev");
    expect(empty.devLastDataRow).toBe(empty.devFirstDataRow - 1);
    expect(empty.aoa[empty.devSectionTitleRow]).toEqual(["BY DEVELOPER"]);
    expect(empty.aoa[empty.devHeaderRow]).toEqual([
      "Assignee", "Sprints active", "Done pts", "Total pts", "Avg done / sprint",
    ]);
  });

  it("keeps devSectionTitleRow < devHeaderRow < devFirstDataRow, and the section is the tail of the AoA", () => {
    expect(layout.devSectionTitleRow).toBeLessThan(layout.devHeaderRow);
    expect(layout.devHeaderRow).toBeLessThan(layout.devFirstDataRow);
    expect(layout.aoa.length).toBe(layout.devLastDataRow + 1);
  });
});

describe("buildTeamTrendsWorkbook (bytes)", () => {
  it("returns a non-empty .xlsx ArrayBuffer named 'Team trends'", () => {
    const buf = buildTeamTrendsWorkbook(REPORT, "Dev");
    expect(buf).toBeInstanceOf(ArrayBuffer);
    expect(buf.byteLength).toBeGreaterThan(0);
    const head = new Uint8Array(buf).slice(0, 2);
    expect(head[0]).toBe(0x50); // 'P'
    expect(head[1]).toBe(0x4b); // 'K'

    const wb = XLSX.read(buf, { type: "array" });
    expect(wb.SheetNames).toEqual(["Team trends"]);
    const ws = wb.Sheets["Team trends"]!;
    expect(ws["A1"]?.v).toBe("TEAM TRENDS");
  });
});

describe("developerKpisAoa (layout)", () => {
  const layout = developerKpisAoa(DEV_KPIS, "Dev");

  it("uses the exact sheet name 'Developer KPIs'", () => {
    expect(layout.sheetName).toBe("Developer KPIs");
  });

  it("one block per dev, in the SAME order as the input (kpiAdjust order)", () => {
    expect(layout.blocks.map((b) => b.name)).toEqual(["Alice", "Bob"]);
  });

  it("bold dev header row content — name, avg done, met N of M", () => {
    const alice = layout.blocks[0]!;
    expect(layout.aoa[alice.headerRow]![0]).toBe("Alice — avg done 4.5 · met 1 of 2 sprints");
    const bob = layout.blocks[1]!;
    expect(layout.aoa[bob.headerRow]![0]).toBe("Bob — avg done 8 · met 2 of 2 sprints");
  });

  it("sub-header row has the exact 6 columns", () => {
    const alice = layout.blocks[0]!;
    expect(layout.aoa[alice.subHeaderRow]).toEqual(["Sprint", "Done", "Total", "Leaves (d)", "Target (adj)", "Met"]);
  });

  it("renders Met as the text 'Yes'/'No' per sprint row", () => {
    const alice = layout.blocks[0]!;
    const row1 = layout.aoa[alice.firstDataRow]!;
    expect(row1).toEqual(["Sprint 4", 8, 8, 0, 8, "Yes"]);
    const row2 = layout.aoa[alice.firstDataRow + 1]!;
    expect(row2).toEqual(["Sprint 6", 1, 5, 2, 6, "No"]);
    expect(alice.lastDataRow).toBe(alice.firstDataRow + 1);
  });

  it("separates each dev block with a blank spacer row", () => {
    const alice = layout.blocks[0]!;
    const bob = layout.blocks[1]!;
    const spacerRow = alice.lastDataRow + 1;
    expect(layout.aoa[spacerRow]).toEqual([]);
    expect(bob.headerRow).toBe(spacerRow + 1);
  });

  it("never mentions Unassigned anywhere in the sheet (v1.61, ADR-073, item 176 — guaranteed upstream by kpiAdjust.ts)", () => {
    const flat = layout.aoa.flat().map(String);
    expect(flat).not.toContain("Unassigned");
    expect(flat.some((c) => c.includes("Unassigned"))).toBe(false);
  });

  it("handles an empty devKpis list without throwing (no blocks)", () => {
    const empty = developerKpisAoa([], "Dev");
    expect(empty.blocks).toEqual([]);
  });
});

describe("buildDeveloperKpisWorkbook (bytes)", () => {
  it("returns a non-empty .xlsx ArrayBuffer named 'Developer KPIs'", () => {
    const buf = buildDeveloperKpisWorkbook(DEV_KPIS, "Dev");
    expect(buf).toBeInstanceOf(ArrayBuffer);
    expect(buf.byteLength).toBeGreaterThan(0);
    const head = new Uint8Array(buf).slice(0, 2);
    expect(head[0]).toBe(0x50);
    expect(head[1]).toBe(0x4b);

    const wb = XLSX.read(buf, { type: "array" });
    expect(wb.SheetNames).toEqual(["Developer KPIs"]);
    const ws = wb.Sheets["Developer KPIs"]!;
    expect(ws["A1"]?.v).toBe("DEVELOPER KPIS");
  });
});
