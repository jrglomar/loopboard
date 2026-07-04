// sprintReviewXlsx.ts — styled-workbook layout (v1.38, ADR-048). The AoA layout is pure; the
// byte output is smoke-checked (non-empty ArrayBuffer). Keyless/offline.

import { describe, it, expect } from "vitest";
import { sprintReviewAoa, sprintReviewXlsxArray } from "./sprintReviewXlsx";
import { MEMBER_COLUMNS } from "./sprintReview";
import type { SprintReport } from "./types";
import type { LeavesMap } from "./leavesClient";
import type { OffsetLedger } from "./offsetClient";
import type { SprintReviewForm } from "./reportMarkdown";

const REPORT: SprintReport = {
  sprint: {
    id: 1, name: "Bane.2026.06.02.137", state: "closed",
    startDate: "2026-06-01", endDate: "2026-06-12", completeDate: "2026-06-12", goal: "SSC Hypercare", boardId: 1,
  },
  committedPoints: 21, completedPoints: 18, completionRate: 18 / 21,
  totalCount: 3, completedCount: 2, carryoverCount: 1, blockedCount: 0,
  completed: [], notCompleted: [],
  byAssignee: [
    { name: "Alice", donePoints: 13, totalPoints: 13, doneCount: 2, totalCount: 2 },
    { name: "Bob", donePoints: 5, totalPoints: 8, doneCount: 1, totalCount: 2 },
  ],
};
const LEAVES: LeavesMap = { Alice: { "2026-06-01": "VL", "2026-06-02": "Offset" } };
const LEDGER: OffsetLedger = { Alice: { earned: 1, spent: 0, manualAdjust: 0, balance: 1 } };
const FORM: SprintReviewForm = {
  teamName: "Vibranium", scrumMaster: "Amiel Canta", commitmentPoints: "21",
  reasonForDelays: "", whatWorkedWell: "Security", whatDidNotWork: "", plannedImprovements: "", kudos: "",
};

describe("sprintReviewAoa (layout)", () => {
  const layout = sprintReviewAoa(REPORT, FORM, ["VRDB-1: FLYIN"], LEAVES, LEDGER, 8);

  it("bands the title and lists the sprint in the subtitle", () => {
    expect(layout.aoa[layout.titleRows[0]!]![0]).toBe("SPRINT REVIEW");
    expect(String(layout.aoa[layout.titleRows[1]!]![0])).toContain("Bane.2026.06.02.137");
  });

  it("has the member table header at memberHeaderRow", () => {
    expect(layout.aoa[layout.memberHeaderRow]).toEqual([...MEMBER_COLUMNS]);
  });

  it("writes member points/leaves as real numbers (Excel can sum them)", () => {
    const alice = layout.aoa[layout.memberFirstDataRow]!;
    expect(alice[0]).toBe("Alice");
    expect(alice[1]).toBe(6); // committed = 8 − (1 VL + 1 Offset)
    expect(alice[2]).toBe(13); // completed (done points)
    expect(alice[3]).toBe(1); // VL
    expect(alice[6]).toBe(1); // Offset
    expect(alice[8]).toBe(1); // offset balance
  });

  it("ends the member block with a bold TOTAL row", () => {
    const total = layout.aoa[layout.totalRow]!;
    expect(total[0]).toBe("TOTAL");
    expect(total[1]).toBe(14); // committed total (Alice 6 + Bob 8)
    expect(total[2]).toBe(18); // completed total (13 + 5)
  });

  it("carries the retro fields into the sheet", () => {
    const flat = layout.aoa.flat().map(String);
    expect(flat).toContain("Team name");
    expect(flat).toContain("Vibranium");
    expect(flat).toContain("Retrospective");
  });
});

describe("sprintReviewXlsxArray (bytes)", () => {
  it("returns a non-empty .xlsx ArrayBuffer", () => {
    const buf = sprintReviewXlsxArray(REPORT, FORM, [], LEAVES, LEDGER, 8);
    expect(buf).toBeInstanceOf(ArrayBuffer);
    expect(buf.byteLength).toBeGreaterThan(0);
    // xlsx is a zip → starts with "PK".
    const head = new Uint8Array(buf).slice(0, 2);
    expect(head[0]).toBe(0x50); // 'P'
    expect(head[1]).toBe(0x4b); // 'K'
  });
});
