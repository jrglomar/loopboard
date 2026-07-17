// sprintRange.ts unit tests — Trends & KPIs sprint-window helpers (v1.59, ADR-071).
// Pure functions; no mocks needed. Keyless/offline.

import { describe, it, expect } from "vitest";
import { lastNClosedSprintIds, sprintIdsInDateRange } from "./sprintRange";
import type { SprintRef } from "./types";

function sprint(partial: Partial<SprintRef> & { id: number }): SprintRef {
  return {
    id: partial.id,
    name: partial.name ?? `Sprint ${partial.id}`,
    state: partial.state ?? "closed",
    startDate: partial.startDate ?? null,
    endDate: partial.endDate ?? null,
    completeDate: partial.completeDate ?? null,
    goal: partial.goal ?? null,
    boardId: partial.boardId ?? 1,
  };
}

// Closed sprints, LATEST-FIRST (the list_sprints / useSprintList convention) — id 5 is the
// most recently started/closed sprint, id 1 the oldest.
const CLOSED_LATEST_FIRST: SprintRef[] = [
  sprint({ id: 5, name: "Sprint 5", startDate: "2026-05-01", endDate: "2026-05-14" }),
  sprint({ id: 4, name: "Sprint 4", startDate: "2026-04-17", endDate: "2026-04-30" }),
  sprint({ id: 3, name: "Sprint 3", startDate: "2026-04-03", endDate: "2026-04-16" }),
  sprint({ id: 2, name: "Sprint 2", startDate: "2026-03-20", endDate: "2026-04-02" }),
  sprint({ id: 1, name: "Sprint 1", startDate: "2026-03-06", endDate: "2026-03-19" }),
];

describe("lastNClosedSprintIds", () => {
  it("returns [] for an empty closed list", () => {
    expect(lastNClosedSprintIds([], 10)).toEqual([]);
  });

  it("returns [] for n <= 0", () => {
    expect(lastNClosedSprintIds(CLOSED_LATEST_FIRST, 0)).toEqual([]);
    expect(lastNClosedSprintIds(CLOSED_LATEST_FIRST, -3)).toEqual([]);
  });

  it("returns [] for a non-finite n", () => {
    expect(lastNClosedSprintIds(CLOSED_LATEST_FIRST, NaN)).toEqual([]);
    expect(lastNClosedSprintIds(CLOSED_LATEST_FIRST, Infinity)).toEqual([]);
  });

  it("fewer-than-N: uses all closed sprints when n exceeds the list length", () => {
    // 5 closed sprints, ask for 10 → all 5, chronological (oldest → newest)
    expect(lastNClosedSprintIds(CLOSED_LATEST_FIRST, 10)).toEqual([1, 2, 3, 4, 5]);
  });

  it("exactly-N: n equals the closed list length", () => {
    expect(lastNClosedSprintIds(CLOSED_LATEST_FIRST, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("takes exactly the N most-recent sprints, returned chronological", () => {
    // n=3 → the 3 most recent (ids 5,4,3, latest-first) reversed to chronological (3,4,5)
    expect(lastNClosedSprintIds(CLOSED_LATEST_FIRST, 3)).toEqual([3, 4, 5]);
  });

  it("n=1 returns just the single most recent sprint", () => {
    expect(lastNClosedSprintIds(CLOSED_LATEST_FIRST, 1)).toEqual([5]);
  });

  it("floors a fractional n", () => {
    expect(lastNClosedSprintIds(CLOSED_LATEST_FIRST, 2.9)).toEqual([4, 5]);
  });
});

describe("sprintIdsInDateRange", () => {
  const MIXED: SprintRef[] = [
    sprint({ id: 10, state: "closed", startDate: "2026-01-01", endDate: "2026-01-14" }),
    sprint({ id: 11, state: "closed", startDate: "2026-01-15", endDate: "2026-01-28" }),
    sprint({ id: 12, state: "active", startDate: "2026-02-01", endDate: "2026-02-14" }),
    sprint({ id: 13, state: "future", startDate: "2026-02-15", endDate: "2026-02-28" }),
    sprint({ id: 14, state: "closed", startDate: null, endDate: null }), // unknown start
  ];

  it("returns [] for an empty sprints array", () => {
    expect(sprintIdsInDateRange([], "2026-01-01", "2026-02-28")).toEqual([]);
  });

  it("returns [] for empty/missing bounds", () => {
    expect(sprintIdsInDateRange(MIXED, "", "2026-02-28")).toEqual([]);
    expect(sprintIdsInDateRange(MIXED, "2026-01-01", "")).toEqual([]);
  });

  it("returns [] when start is after end", () => {
    expect(sprintIdsInDateRange(MIXED, "2026-02-28", "2026-01-01")).toEqual([]);
  });

  it("includes sprints whose startDate is within the range, inclusive bounds", () => {
    // Sprint 10 starts exactly on the lower bound, sprint 11 exactly on the upper bound.
    expect(sprintIdsInDateRange(MIXED, "2026-01-01", "2026-01-28")).toEqual([10, 11]);
  });

  it("excludes future-state sprints even when their startDate is in range", () => {
    const ids = sprintIdsInDateRange(MIXED, "2026-01-01", "2026-02-28");
    expect(ids).not.toContain(13);
  });

  it("skips sprints with a null startDate", () => {
    const ids = sprintIdsInDateRange(MIXED, "2026-01-01", "2026-02-28");
    expect(ids).not.toContain(14);
  });

  it("returns chronological order by startDate ascending", () => {
    expect(sprintIdsInDateRange(MIXED, "2026-01-01", "2026-02-28")).toEqual([10, 11, 12]);
  });

  it("returns [] when no sprint falls in the range (empty result)", () => {
    expect(sprintIdsInDateRange(MIXED, "2020-01-01", "2020-01-31")).toEqual([]);
  });
});
