/**
 * Sprint selection unit tests — pure function, no network.
 * Covers: sort by startDate (desc), null startDate last, id tiebreak,
 * explicit sprintId selection, invalid sprintId error.
 */
import { describe, it, expect } from "vitest";
import {
  sortSprintsLatestFirst,
  selectSprint,
  type SprintStub,
} from "../src/lib/sprintSelect.js";
import { UpstreamError } from "../src/lib/errors.js";

function makeSprint(overrides: Partial<SprintStub>): SprintStub {
  return {
    id: 1,
    name: "Sprint 1",
    state: "active",
    startDate: "2026-06-01T00:00:00.000Z",
    endDate: "2026-06-14T00:00:00.000Z",
    goal: null,
    ...overrides,
  };
}

describe("sortSprintsLatestFirst", () => {
  it("sorts latest startDate first", () => {
    const sprints = [
      makeSprint({ id: 1, startDate: "2026-05-01T00:00:00.000Z" }),
      makeSprint({ id: 2, startDate: "2026-06-01T00:00:00.000Z" }),
      makeSprint({ id: 3, startDate: "2026-04-01T00:00:00.000Z" }),
    ];
    const sorted = sortSprintsLatestFirst(sprints);
    expect(sorted.map((s) => s.id)).toEqual([2, 1, 3]);
  });

  it("null startDate sorts last", () => {
    const sprints = [
      makeSprint({ id: 1, startDate: null }),
      makeSprint({ id: 2, startDate: "2026-06-01T00:00:00.000Z" }),
      makeSprint({ id: 3, startDate: null }),
    ];
    const sorted = sortSprintsLatestFirst(sprints);
    expect(sorted[0]!.id).toBe(2);
    // Both null sprints come after the dated one; tiebreaker: descending id
    expect(sorted[1]!.id).toBe(3); // higher id
    expect(sorted[2]!.id).toBe(1);
  });

  it("ties broken by descending id", () => {
    const sprints = [
      makeSprint({ id: 5, startDate: "2026-06-01T00:00:00.000Z" }),
      makeSprint({ id: 9, startDate: "2026-06-01T00:00:00.000Z" }),
      makeSprint({ id: 2, startDate: "2026-06-01T00:00:00.000Z" }),
    ];
    const sorted = sortSprintsLatestFirst(sprints);
    expect(sorted.map((s) => s.id)).toEqual([9, 5, 2]);
  });

  it("returns new array, does not mutate input", () => {
    const sprints = [
      makeSprint({ id: 1, startDate: "2026-05-01T00:00:00.000Z" }),
      makeSprint({ id: 2, startDate: "2026-06-01T00:00:00.000Z" }),
    ];
    const copy = [...sprints];
    sortSprintsLatestFirst(sprints);
    expect(sprints[0]!.id).toBe(copy[0]!.id);
    expect(sprints[1]!.id).toBe(copy[1]!.id);
  });

  it("handles single element", () => {
    const sprints = [makeSprint({ id: 42 })];
    const sorted = sortSprintsLatestFirst(sprints);
    expect(sorted).toHaveLength(1);
    expect(sorted[0]!.id).toBe(42);
  });

  it("handles empty array", () => {
    expect(sortSprintsLatestFirst([])).toEqual([]);
  });
});

describe("selectSprint", () => {
  const sorted = [
    makeSprint({ id: 3, startDate: "2026-06-10T00:00:00.000Z", name: "Latest" }),
    makeSprint({ id: 2, startDate: "2026-06-01T00:00:00.000Z", name: "Middle" }),
    makeSprint({ id: 1, startDate: "2026-05-01T00:00:00.000Z", name: "Oldest" }),
  ];

  it("returns first sprint when no sprintId given (latest-started)", () => {
    const selected = selectSprint(sorted, 1000);
    expect(selected.id).toBe(3);
    expect(selected.name).toBe("Latest");
  });

  it("selects explicit sprintId from list", () => {
    const selected = selectSprint(sorted, 1000, 2);
    expect(selected.id).toBe(2);
    expect(selected.name).toBe("Middle");
  });

  it("throws UpstreamError when explicit sprintId not in list", () => {
    expect(() => selectSprint(sorted, 1000, 999)).toThrow(UpstreamError);
    expect(() => selectSprint(sorted, 1000, 999)).toThrow(
      "Sprint 999 is not an active sprint on board 1000"
    );
  });

  it("throws UpstreamError with correct boardId in message", () => {
    expect(() => selectSprint(sorted, 42, 999)).toThrow(
      "Sprint 999 is not an active sprint on board 42"
    );
  });

  it("throws UpstreamError when list is empty (no active sprint)", () => {
    expect(() => selectSprint([], 1000)).toThrow(UpstreamError);
    expect(() => selectSprint([], 1000)).toThrow(
      "No active sprint found for board 1000"
    );
  });

  it("throws UpstreamError when list is empty even with explicit sprintId", () => {
    expect(() => selectSprint([], 1000, 5)).toThrow(
      "No active sprint found for board 1000"
    );
  });
});
