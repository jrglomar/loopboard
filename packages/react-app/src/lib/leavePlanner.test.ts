// leavePlanner.ts unit tests — v1.29, ADR-041. Pure; keyless/offline.

import { describe, it, expect } from "vitest";
import { selectCalendarSprints, buildLeaveCalendar } from "./leavePlanner";
import type { SprintRef } from "./types";

function sprint(over: Partial<SprintRef>): SprintRef {
  return {
    id: 1, name: "S", state: "active", startDate: null, endDate: null,
    completeDate: null, goal: null, boardId: 10, ...over,
  };
}

describe("selectCalendarSprints", () => {
  const A = sprint({ id: 1, name: "A", state: "closed", startDate: "2026-05-01", endDate: "2026-05-14" });
  const B = sprint({ id: 2, name: "B", state: "closed", startDate: "2026-05-15", endDate: "2026-05-28" });
  const C = sprint({ id: 3, name: "C", state: "active", startDate: "2026-05-29", endDate: "2026-06-11" });
  const D = sprint({ id: 4, name: "D", state: "future", startDate: "2026-06-12", endDate: "2026-06-25" });
  const E = sprint({ id: 5, name: "E", state: "future", startDate: "2026-06-26", endDate: "2026-07-09" });

  it("anchors on the sprint containing today and returns a recent+current+upcoming window", () => {
    // today is inside C → window before=1/after=1 = [B, C, D]
    const win = selectCalendarSprints([E, A, C, B, D], { before: 1, after: 1, today: "2026-06-05" });
    expect(win.map((s) => s.name)).toEqual(["B", "C", "D"]);
  });

  it("anchors on the latest-started sprint when many are 'active' and today is past their ranges", () => {
    const a1 = sprint({ id: 1, name: "a1", state: "active", startDate: "2026-05-01", endDate: "2026-05-14" });
    const a2 = sprint({ id: 2, name: "a2", state: "active", startDate: "2026-05-15", endDate: "2026-05-28" });
    const a3 = sprint({ id: 3, name: "a3", state: "active", startDate: "2026-05-29", endDate: "2026-06-11" });
    // today after all ranges → anchor = a3 (latest started); before=1/after=1 → [a2, a3]
    const win = selectCalendarSprints([a1, a2, a3], { before: 1, after: 1, today: "2026-07-01" });
    expect(win.map((s) => s.name)).toEqual(["a2", "a3"]);
  });

  it("anchors on the first upcoming sprint when none has started yet", () => {
    const win = selectCalendarSprints([D, E], { before: 1, after: 0, today: "2026-06-01" });
    expect(win.map((s) => s.name)).toEqual(["D"]);
  });

  it("ignores sprints without both dates", () => {
    const undated = sprint({ id: 9, name: "X", startDate: null, endDate: null });
    const win = selectCalendarSprints([undated, C], { before: 2, after: 2, today: "2026-06-05" });
    expect(win.map((s) => s.name)).toEqual(["C"]);
  });
});

describe("buildLeaveCalendar", () => {
  it("emits Mon–Fri days only (weekends excluded) attributed to their sprint", () => {
    // 2026-06-01 is a Monday; 06-06/07 are Sat/Sun
    const s = sprint({ id: 7, name: "S7", startDate: "2026-06-01", endDate: "2026-06-07" });
    const cal = buildLeaveCalendar([s]);
    expect(cal.days.map((d) => d.date)).toEqual(["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05"]);
    expect(cal.days.every((d) => d.sprintId === 7)).toBe(true);
    expect(cal.segments[0]!.days.length).toBe(5);
    expect(cal.dateToSprintId["2026-06-04"]).toBe(7);
  });

  it("dedupes overlapping dates — the first sprint in the list wins", () => {
    const s1 = sprint({ id: 1, name: "S1", startDate: "2026-06-01", endDate: "2026-06-05" }); // Mon–Fri
    const s2 = sprint({ id: 2, name: "S2", startDate: "2026-06-04", endDate: "2026-06-10" }); // overlaps 04,05
    const cal = buildLeaveCalendar([s1, s2]);
    expect(cal.dateToSprintId["2026-06-04"]).toBe(1); // claimed by S1
    expect(cal.dateToSprintId["2026-06-05"]).toBe(1);
    // S2 keeps only its non-overlapping working days (08,09,10)
    expect(cal.segments[1]!.days).toEqual(["2026-06-08", "2026-06-09", "2026-06-10"]);
  });
});
