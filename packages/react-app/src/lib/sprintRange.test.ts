// sprintRange.ts unit tests — Trends & KPIs sprint-window helpers (v1.59, ADR-071).
// Pure functions; no mocks needed. Keyless/offline.

import { describe, it, expect } from "vitest";
import {
  lastNClosedSprintIds,
  sprintIdsInDateRange,
  defaultRangeFromClosed,
  capSprintWindow,
  MAX_SPRINT_WINDOW,
} from "./sprintRange";
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

// v1.60 (ADR-072): default "date range" window pre-fill — Trends & KPIs mode 2 defaults to
// "range" instead of "recent", pre-filled to the span of the last N closed sprints.
describe("defaultRangeFromClosed", () => {
  const TODAY = "2026-07-17";

  it("returns null for an empty closed list", () => {
    expect(defaultRangeFromClosed([], 10, TODAY)).toBeNull();
  });

  it("returns null for n <= 0 or non-finite", () => {
    expect(defaultRangeFromClosed(CLOSED_LATEST_FIRST, 0, TODAY)).toBeNull();
    expect(defaultRangeFromClosed(CLOSED_LATEST_FIRST, -3, TODAY)).toBeNull();
    expect(defaultRangeFromClosed(CLOSED_LATEST_FIRST, NaN, TODAY)).toBeNull();
  });

  it("fewer-than-n: uses all closed sprints — start is the oldest of them", () => {
    // 5 closed sprints, ask for 10 → all 5 considered, oldest startDate is id 1's "2026-03-06".
    expect(defaultRangeFromClosed(CLOSED_LATEST_FIRST, 10, TODAY)).toEqual({
      start: "2026-03-06",
      end: TODAY,
    });
  });

  it("exactly-N: start is the Nth-most-recent closed sprint's startDate", () => {
    // n=3 → ids 5,4,3 (latest-first) → startDates 05-01, 04-17, 04-03 → min = id 3's 04-03.
    expect(defaultRangeFromClosed(CLOSED_LATEST_FIRST, 3, TODAY)).toEqual({
      start: "2026-04-03",
      end: TODAY,
    });
  });

  it("end is todayIso, passed through verbatim", () => {
    expect(defaultRangeFromClosed(CLOSED_LATEST_FIRST, 1, "2099-01-01")!.end).toBe("2099-01-01");
  });

  it("slices a full ISO timestamp startDate down to YYYY-MM-DD", () => {
    const closed: SprintRef[] = [
      sprint({ id: 1, startDate: "2026-05-12T00:00:00.000Z", endDate: "2026-05-25T00:00:00.000Z" }),
    ];
    expect(defaultRangeFromClosed(closed, 10, TODAY)).toEqual({ start: "2026-05-12", end: TODAY });
  });

  it("skips a null startDate within the slice, using the min of the rest", () => {
    const closed: SprintRef[] = [
      sprint({ id: 3, startDate: null }), // most recent, but unknown date
      sprint({ id: 2, startDate: "2026-04-20" }),
      sprint({ id: 1, startDate: "2026-03-06" }),
    ];
    expect(defaultRangeFromClosed(closed, 10, TODAY)).toEqual({ start: "2026-03-06", end: TODAY });
  });

  it("returns null when every sprint in the slice has a null startDate", () => {
    const closed: SprintRef[] = [sprint({ id: 2, startDate: null }), sprint({ id: 1, startDate: null })];
    expect(defaultRangeFromClosed(closed, 10, TODAY)).toBeNull();
  });
});

// v1.61 (ADR-073, item 175): client-side cap at the §4.29 sprintIds limit (26) — "range" and
// "pick" mode selections can exceed it on a real board; keep the NEWEST ids (chronological
// oldest→newest convention throughout this lib, so "newest" = the tail).
describe("capSprintWindow", () => {
  it("MAX_SPRINT_WINDOW is 26", () => {
    expect(MAX_SPRINT_WINDOW).toBe(26);
  });

  it("under the cap: returns the ids unchanged, capped false", () => {
    const ids = [1, 2, 3];
    expect(capSprintWindow(ids)).toEqual({ ids: [1, 2, 3], capped: false });
  });

  it("exactly at the cap: returns the ids unchanged, capped false", () => {
    const ids = Array.from({ length: 26 }, (_, i) => i + 1); // chronological 1..26
    const result = capSprintWindow(ids);
    expect(result.capped).toBe(false);
    expect(result.ids).toEqual(ids);
    expect(result.ids).toHaveLength(26);
  });

  it("over the cap: keeps the NEWEST 26 (the tail — highest ids here) and reports capped true", () => {
    const ids = Array.from({ length: 30 }, (_, i) => i + 1); // chronological 1..30
    const result = capSprintWindow(ids);
    expect(result.capped).toBe(true);
    expect(result.ids).toHaveLength(26);
    expect(result.ids).toEqual(Array.from({ length: 26 }, (_, i) => i + 5)); // 5..30
    expect(result.ids[0]).toBe(5);
    expect(result.ids[result.ids.length - 1]).toBe(30);
  });

  it("honors a custom max override", () => {
    const ids = [1, 2, 3, 4, 5];
    expect(capSprintWindow(ids, 3)).toEqual({ ids: [3, 4, 5], capped: true });
  });

  it("does not mutate the input array", () => {
    const ids = Array.from({ length: 30 }, (_, i) => i + 1);
    const copy = [...ids];
    capSprintWindow(ids);
    expect(ids).toEqual(copy);
  });
});
