// sprintReview.ts — per-member table + printable HTML (v1.38, ADR-048). Pure, keyless, offline.

import { describe, it, expect } from "vitest";
import { buildMemberReviewTable, buildSprintReviewHtml, memberRowCells } from "./sprintReview";
import type { SprintReport } from "./types";
import type { LeavesMap } from "./leavesClient";
import type { OffsetLedger } from "./offsetClient";
import type { SprintReviewForm } from "./reportMarkdown";

const N = 8; // required points

// 2026-06-01 is a Monday → 06-01..06-05 + 06-08..06-12 are the 10 sprint working days.
const REPORT: SprintReport = {
  sprint: {
    id: 1, name: "Bane.2026.06.02.137", state: "closed",
    startDate: "2026-06-01", endDate: "2026-06-12", completeDate: "2026-06-12",
    goal: "SSC Hypercare\nHRT's Cloud, Panda CTRAC Rewrite", boardId: 1,
  },
  committedPoints: 21, completedPoints: 18, completionRate: 18 / 21,
  totalCount: 4, completedCount: 3, carryoverCount: 1, blockedCount: 0,
  completed: [], notCompleted: [],
  byAssignee: [
    { name: "Bob", donePoints: 5, totalPoints: 8, doneCount: 1, totalCount: 2 },
    { name: "Alice", donePoints: 13, totalPoints: 13, doneCount: 2, totalCount: 2 },
    { name: "Unassigned", donePoints: 0, totalPoints: 0, doneCount: 0, totalCount: 0 },
  ],
};

const LEAVES: LeavesMap = {
  Alice: { "2026-06-01": "VL", "2026-06-02": "Offset" }, // 2 leave days → committed 8 − 2 = 6
  Bob: { "2026-06-03": "EL" }, // 1 leave day → committed 8 − 1 = 7
};
const LEDGER: OffsetLedger = {
  Alice: { earned: 1, spent: 0, manualAdjust: 0, balance: 1 },
  Bob: { earned: 0, spent: 0, manualAdjust: 0, balance: 0 },
};

const FORM: SprintReviewForm = {
  teamName: "Vibranium", scrumMaster: "Amiel Canta", commitmentPoints: "21",
  reasonForDelays: "N/A", whatWorkedWell: "Security enhancements",
  whatDidNotWork: "N/A", plannedImprovements: "N/A", kudos: "Great sprint",
};

describe("buildMemberReviewTable", () => {
  it("committed = required N − leave days (NOT assigned tickets); completed = done points", () => {
    const { rows } = buildMemberReviewTable(REPORT, LEAVES, LEDGER, N);
    const alice = rows.find((r) => r.name === "Alice")!;
    expect(alice).toMatchObject({
      committedPoints: 6, // 8 − (1 VL + 1 Offset), NOT the 13 assigned points
      completedPoints: 13, vl: 1, el: 0, holiday: 0, offset: 1, leaveTotal: 2, offsetBalance: 1,
    });
    const bob = rows.find((r) => r.name === "Bob")!;
    expect(bob).toMatchObject({ committedPoints: 7, completedPoints: 5, el: 1, leaveTotal: 1 });
  });

  it("floors committed at 0 and gives Unassigned no commitment", () => {
    const heavy: LeavesMap = { Alice: Object.fromEntries(
      ["01", "02", "03", "04", "05", "08", "09", "10", "11", "12"].map((d) => [`2026-06-${d}`, "VL"])
    ) };
    const { rows } = buildMemberReviewTable(REPORT, heavy, LEDGER, N);
    expect(rows.find((r) => r.name === "Alice")!.committedPoints).toBe(0); // 8 − 10 → floored
    expect(rows.find((r) => r.name === "Unassigned")!.committedPoints).toBe(0);
  });

  it("sorts members alphabetically with Unassigned last", () => {
    const { rows } = buildMemberReviewTable(REPORT, LEAVES, LEDGER, N);
    expect(rows.map((r) => r.name)).toEqual(["Alice", "Bob", "Unassigned"]);
  });

  it("totals capacity commitments + completed + leave days across members", () => {
    const { totals } = buildMemberReviewTable(REPORT, LEAVES, LEDGER, N);
    expect(totals).toMatchObject({ committedPoints: 13, completedPoints: 18, vl: 1, el: 1, offset: 1, leaveTotal: 3 });
  });

  it("includes people who have leaves but no points", () => {
    const leavesOnly: LeavesMap = { ...LEAVES, Carol: { "2026-06-04": "Holiday" } };
    const { rows } = buildMemberReviewTable(REPORT, leavesOnly, LEDGER, N);
    const carol = rows.find((r) => r.name === "Carol")!;
    expect(carol).toMatchObject({ committedPoints: 7, completedPoints: 0, holiday: 1, leaveTotal: 1 });
  });

  it("counts every roster developer's full capacity, even with no tickets or leaves", () => {
    // Dave is only on the roster (no tickets, no leaves, no ledger) → full commitment 8.
    const { rows, totals } = buildMemberReviewTable(REPORT, LEAVES, LEDGER, N, ["Alice", "Bob", "Dave"]);
    expect(rows.find((r) => r.name === "Dave")).toMatchObject({ committedPoints: 8, completedPoints: 0, leaveTotal: 0 });
    // commitment total = Alice 6 + Bob 7 + Dave 8 + Unassigned 0 = 21
    expect(totals.committedPoints).toBe(21);
  });

  it("renders an offset balance with a + sign only when positive", () => {
    const { rows } = buildMemberReviewTable(REPORT, LEAVES, LEDGER, N);
    expect(memberRowCells(rows.find((r) => r.name === "Alice")!).at(-1)).toBe("+1");
    expect(memberRowCells(rows.find((r) => r.name === "Bob")!).at(-1)).toBe("0");
  });
});

describe("buildSprintReviewHtml", () => {
  it("produces a standalone doc with the summary, per-member table, and retro sections", () => {
    const html = buildSprintReviewHtml(REPORT, FORM, ["VRDB-1: FLYIN"], LEAVES, LEDGER, N);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("Sprint Review");
    expect(html).toContain("Bane.2026.06.02.137");
    expect(html).toContain("Per-member");
    expect(html).toContain("Alice");
    expect(html).toContain("Vibranium");
    expect(html).toContain("Great sprint");
    expect(html).toContain("VRDB-1: FLYIN");
  });

  it("normalizes a multi-line sprint goal into one separated line (no truncation)", () => {
    const html = buildSprintReviewHtml(REPORT, FORM, [], LEAVES, LEDGER, N);
    // all goals present, joined with " · " — not truncated to just "SSC Hypercare"
    expect(html).toContain("SSC Hypercare · HRT's Cloud, Panda CTRAC Rewrite");
  });

  it("escapes HTML in user-entered fields", () => {
    const html = buildSprintReviewHtml(REPORT, { ...FORM, kudos: "<script>x</script>" }, [], LEAVES, LEDGER, N);
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
