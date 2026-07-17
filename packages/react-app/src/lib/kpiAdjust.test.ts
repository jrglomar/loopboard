// kpiAdjust.ts unit tests — leave-adjusted per-developer KPIs (v1.60, ADR-072).
// Pure; no mocks needed. Keyless/offline.

import { describe, it, expect } from "vitest";
import { computeDevKpis } from "./kpiAdjust";
import type { AllLeavesMap } from "./leavesClient";
import type { AssigneeStats, MultiSprintEntry, MultiSprintReport, SprintRef } from "./types";

function sprintRef(id: number, name: string): SprintRef {
  return {
    id,
    name,
    state: "closed",
    startDate: null,
    endDate: null,
    completeDate: null,
    goal: null,
    boardId: 1,
  };
}

function assignee(name: string, donePoints: number, totalPoints: number): AssigneeStats {
  return { name, donePoints, totalPoints, doneCount: 0, totalCount: 1 };
}

function entry(id: number, name: string, byAssignee: AssigneeStats[]): MultiSprintEntry {
  return {
    sprint: sprintRef(id, name),
    committedPoints: 0,
    completedPoints: 0,
    completionRate: 0,
    totalCount: 0,
    completedCount: 0,
    carryoverCount: 0,
    blockedCount: 0,
    byAssignee,
  };
}

function report(sprints: MultiSprintEntry[]): MultiSprintReport {
  return {
    boardId: 1,
    sprintCount: sprints.length,
    sprints,
    totals: { committedPoints: 0, completedPoints: 0 },
    averageCompleted: 0,
    averageCompletionRate: 0,
    byAssignee: [],
  };
}

describe("computeDevKpis", () => {
  it("counts leave days of ANY type equally toward leaveDays", () => {
    const r = report([entry(1, "S1", [assignee("Alice", 5, 8)])]);
    const leaves: AllLeavesMap = {
      "1": { Alice: { "2026-06-01": "VL", "2026-06-02": "EL", "2026-06-03": "Holiday", "2026-06-04": "Offset" } },
    };
    const [alice] = computeDevKpis(r, leaves, 8);
    expect(alice!.perSprint[0]!.leaveDays).toBe(4);
    expect(alice!.perSprint[0]!.adjustedTarget).toBe(4); // 8 - 4
  });

  it("floors adjustedTarget at 0 when leave days exceed requiredPoints", () => {
    const r = report([entry(1, "S1", [assignee("Alice", 0, 0)])]);
    const leaves: AllLeavesMap = {
      "1": { Alice: { "2026-06-01": "VL", "2026-06-02": "VL", "2026-06-03": "VL" } },
    };
    const [alice] = computeDevKpis(r, leaves, 2);
    expect(alice!.perSprint[0]!.leaveDays).toBe(3);
    expect(alice!.perSprint[0]!.adjustedTarget).toBe(0);
  });

  it("treats a fully-covered sprint (adjustedTarget 0) as met even at 0 done points", () => {
    const r = report([entry(1, "S1", [])]); // Alice has no issues this sprint
    const leaves: AllLeavesMap = { "1": { Alice: { "2026-06-01": "VL", "2026-06-02": "VL" } } };
    const [alice] = computeDevKpis(r, leaves, 2);
    expect(alice!.perSprint[0]!.donePoints).toBe(0);
    expect(alice!.perSprint[0]!.adjustedTarget).toBe(0);
    expect(alice!.perSprint[0]!.met).toBe(true);
  });

  it("includes a dev with plotted leave but zero tickets anywhere in the window (leaves-only)", () => {
    const r = report([
      entry(1, "S1", [assignee("Bob", 5, 5)]),
      entry(2, "S2", [assignee("Bob", 3, 3)]),
    ]);
    const leaves: AllLeavesMap = { "2": { Carol: { "2026-06-10": "VL" } } };
    const kpis = computeDevKpis(r, leaves, 8);
    expect(kpis.map((k) => k.name)).toContain("Carol");
    const carol = kpis.find((k) => k.name === "Carol")!;
    expect(carol.perSprint.map((s) => s.donePoints)).toEqual([0, 0]);
    expect(carol.perSprint.map((s) => s.active)).toEqual([false, false]);
    expect(carol.perSprint[1]!.leaveDays).toBe(1);
  });

  it("zeros donePoints/totalPoints for a sprint where the dev is absent from byAssignee", () => {
    const r = report([
      entry(1, "S1", [assignee("Alice", 5, 8)]),
      entry(2, "S2", []), // Alice absent this sprint
    ]);
    const kpis = computeDevKpis(r, {}, 8);
    const alice = kpis.find((k) => k.name === "Alice")!;
    expect(alice.perSprint[0]).toMatchObject({ donePoints: 5, totalPoints: 8, active: true });
    expect(alice.perSprint[1]).toMatchObject({ donePoints: 0, totalPoints: 0, active: false });
  });

  it("averages donePoints over the FULL window, not just sprints the dev was active in", () => {
    const r = report([
      entry(1, "S1", [assignee("Alice", 6, 6)]),
      entry(2, "S2", []), // Alice absent — still counts toward the window denominator
      entry(3, "S3", [assignee("Alice", 3, 3)]),
    ]);
    const kpis = computeDevKpis(r, {}, 8);
    const alice = kpis.find((k) => k.name === "Alice")!;
    expect(alice.totals.donePoints).toBe(9);
    expect(alice.sprintCount).toBe(3);
    expect(alice.avgDonePoints).toBe(3); // 9 / 3, NOT 9 / 2
  });

  it("uses requiredPoints as the target everywhere when the leaves store is empty", () => {
    const r = report([
      entry(1, "S1", [assignee("Alice", 5, 5)]),
      entry(2, "S2", [assignee("Alice", 2, 2)]),
    ]);
    const kpis = computeDevKpis(r, {}, 8);
    const alice = kpis.find((k) => k.name === "Alice")!;
    expect(alice.perSprint.every((s) => s.adjustedTarget === 8 && s.leaveDays === 0)).toBe(true);
  });

  it("sorts by totals.donePoints descending, tie broken by name ascending", () => {
    const r = report([
      entry(1, "S1", [assignee("Zed", 10, 10), assignee("Amy", 10, 10), assignee("Mid", 4, 4)]),
    ]);
    const kpis = computeDevKpis(r, {}, 8);
    expect(kpis.map((k) => k.name)).toEqual(["Amy", "Zed", "Mid"]);
  });

  it("excludes Unassigned even when byAssignee reports it (v1.61, ADR-073 — a ticket state, not a developer)", () => {
    const r = report([entry(1, "S1", [assignee("Unassigned", 2, 4)])]);
    const leaves: AllLeavesMap = { "1": { Unassigned: { "2026-06-01": "VL" } } }; // shouldn't happen in practice
    const kpis = computeDevKpis(r, leaves, 8);
    expect(kpis.map((k) => k.name)).not.toContain("Unassigned");
  });

  it("never pulls Unassigned into the union from the leaves side alone", () => {
    const r = report([entry(2, "S2", [])]); // Unassigned NOT in byAssignee
    const leaves: AllLeavesMap = { "2": { Unassigned: { "2026-06-01": "VL" } } };
    const kpis = computeDevKpis(r, leaves, 8);
    expect(kpis.map((k) => k.name)).not.toContain("Unassigned");
  });

  it("counts metCount across sprints and sums totals.leaveDays/adjustedTarget", () => {
    const r = report([
      entry(1, "S1", [assignee("Alice", 8, 8)]), // met (8 >= 8)
      entry(2, "S2", [assignee("Alice", 1, 1)]), // not met (1 < 8)
    ]);
    const kpis = computeDevKpis(r, {}, 8);
    const alice = kpis.find((k) => k.name === "Alice")!;
    expect(alice.metCount).toBe(1);
    expect(alice.totals).toEqual({ donePoints: 9, leaveDays: 0, adjustedTarget: 16 });
  });

  it("carries sprintId/sprintName through from the report entry", () => {
    const r = report([entry(42, "Sprint 42", [assignee("Alice", 1, 1)])]);
    const kpis = computeDevKpis(r, {}, 8);
    expect(kpis[0]!.perSprint[0]).toMatchObject({ sprintId: 42, sprintName: "Sprint 42" });
  });
});
