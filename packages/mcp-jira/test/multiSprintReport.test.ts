// get_multi_sprint_report — windowed cross-sprint aggregate report (v1.59, ADR-071). Keyless/offline.
//
// Covers the two pure lib additions this tool is built on —
// sortClosedSprintsLatestFirst (sprintSelect.ts, extracted from getVelocity/listSprints in the
// same phase) and aggregateByAssigneeAcrossSprints (reportMath.ts) — plus the tool itself: pool
// selection (default/includeActive/beforeSprintId), explicit sprintIds selection, the sprintIds
// refine rejection, maxResults passthrough, the empty-window shape, and math parity with
// computeSprintPoints/computeByAssignee.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/lib/jiraClient.js", () => ({
  getSprintsByState: vi.fn(),
  getSprintMeta: vi.fn(),
  getSprintIssues: vi.fn(),
}));

import { sortClosedSprintsLatestFirst } from "../src/lib/sprintSelect.js";
import {
  aggregateByAssigneeAcrossSprints,
  computeSprintPoints,
  computeByAssignee,
  makeDodPredicate,
  type AssigneeStats,
} from "../src/lib/reportMath.js";
import { getMultiSprintReportTool } from "../src/tools/getMultiSprintReport.js";
import * as jiraClient from "../src/lib/jiraClient.js";
import { resetConfigCache } from "../src/lib/config.js";
import type { IssueSummary } from "../src/lib/types.js";

const api = jiraClient as unknown as Record<
  "getSprintsByState" | "getSprintMeta" | "getSprintIssues",
  ReturnType<typeof vi.fn>
>;

/** ToolDef handlers are typed `(input: unknown) => Promise<unknown>`; narrow to the slice these tests read. */
type MultiSprintReportOutput = {
  boardId: number;
  sprintCount: number;
  sprints: Array<{
    sprint: {
      id: number;
      name: string;
      state: string;
      startDate: string | null;
      endDate: string | null;
      completeDate: string | null;
      goal: string | null;
      boardId: number;
    };
    committedPoints: number;
    completedPoints: number;
    completionRate: number;
    totalCount: number;
    completedCount: number;
    carryoverCount: number;
    blockedCount: number;
    byAssignee: Array<{
      name: string;
      donePoints: number;
      totalPoints: number;
      doneCount: number;
      totalCount: number;
    }>;
  }>;
  totals: { committedPoints: number; completedPoints: number };
  averageCompleted: number;
  averageCompletionRate: number;
  byAssignee: Array<{
    name: string;
    sprintsActive: number;
    donePoints: number;
    totalPoints: number;
    avgDonePoints: number;
  }>;
};
const run = (input: Record<string, unknown>) =>
  getMultiSprintReportTool.handler(input) as Promise<MultiSprintReportOutput>;

function issue(over: Partial<IssueSummary> = {}): IssueSummary {
  return {
    key: "DEV-1", summary: "Thing", status: "In Progress", statusCategory: "inprogress",
    assignee: "Alice", assigneeAccountId: "a1", storyPoints: 3, issueType: "Task",
    url: "https://j/browse/DEV-1", blocked: false, ...over,
  };
}

interface SprintFields {
  id: number;
  name: string;
  state: string;
  startDate: string | null;
  endDate: string | null;
  completeDate: string | null;
  goal: string | null;
}

function sprintStub(over: Partial<SprintFields> = {}): SprintFields {
  return {
    id: 1,
    name: "Sprint 1",
    state: "closed",
    startDate: "2026-01-01T00:00:00.000Z",
    endDate: "2026-01-14T00:00:00.000Z",
    completeDate: "2026-01-14T00:00:00.000Z",
    goal: null,
    ...over,
  };
}

function sprintMetaStub(over: Partial<SprintFields & { boardId: number }> = {}) {
  return { ...sprintStub(), boardId: 10002, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env["JIRA_BASE_URL"] = "https://test.atlassian.net";
  process.env["JIRA_EMAIL"] = "t@example.com";
  process.env["JIRA_API_TOKEN"] = "tok";
  process.env["JIRA_PO_BOARD_ID"] = "10001";
  process.env["JIRA_DEV_BOARD_ID"] = "10002";
  resetConfigCache();
});

// ------------------------------------------------------------------------
// A. sortClosedSprintsLatestFirst (pure, sprintSelect.ts)
// ------------------------------------------------------------------------

describe("sortClosedSprintsLatestFirst (pure)", () => {
  it("sorts latest-first by completeDate", () => {
    const sprints = [
      sprintStub({ id: 1, completeDate: "2026-01-14T00:00:00.000Z" }),
      sprintStub({ id: 2, completeDate: "2026-03-14T00:00:00.000Z" }),
      sprintStub({ id: 3, completeDate: "2026-02-14T00:00:00.000Z" }),
    ];
    const sorted = sortClosedSprintsLatestFirst(sprints);
    expect(sorted.map((s) => s.id)).toEqual([2, 3, 1]);
  });

  it("falls back to endDate when completeDate is null", () => {
    const sprints = [
      sprintStub({ id: 1, completeDate: null, endDate: "2026-01-14T00:00:00.000Z" }),
      sprintStub({ id: 2, completeDate: null, endDate: "2026-03-14T00:00:00.000Z" }),
    ];
    const sorted = sortClosedSprintsLatestFirst(sprints);
    expect(sorted.map((s) => s.id)).toEqual([2, 1]);
  });

  it("sorts sprints with no date (completeDate and endDate both null) last", () => {
    const sprints = [
      sprintStub({ id: 1, completeDate: null, endDate: null }),
      sprintStub({ id: 2, completeDate: "2026-01-14T00:00:00.000Z" }),
    ];
    const sorted = sortClosedSprintsLatestFirst(sprints);
    expect(sorted.map((s) => s.id)).toEqual([2, 1]);
  });

  it("ties broken by descending id", () => {
    const sprints = [
      sprintStub({ id: 5, completeDate: "2026-01-14T00:00:00.000Z" }),
      sprintStub({ id: 9, completeDate: "2026-01-14T00:00:00.000Z" }),
      sprintStub({ id: 7, completeDate: "2026-01-14T00:00:00.000Z" }),
    ];
    const sorted = sortClosedSprintsLatestFirst(sprints);
    expect(sorted.map((s) => s.id)).toEqual([9, 7, 5]);
  });

  it("does not mutate the input array", () => {
    const sprints = [
      sprintStub({ id: 1, completeDate: "2026-01-14T00:00:00.000Z" }),
      sprintStub({ id: 2, completeDate: "2026-03-14T00:00:00.000Z" }),
    ];
    const original = [...sprints];
    sortClosedSprintsLatestFirst(sprints);
    expect(sprints).toEqual(original);
  });
});

// ------------------------------------------------------------------------
// B. aggregateByAssigneeAcrossSprints (pure, reportMath.ts)
// ------------------------------------------------------------------------

describe("aggregateByAssigneeAcrossSprints (pure)", () => {
  it("sums donePoints/totalPoints across sprints; sprintsActive counts only sprints where present", () => {
    const perSprint: AssigneeStats[][] = [
      [{ name: "Alice", donePoints: 5, totalPoints: 8, doneCount: 1, totalCount: 2 }],
      [], // Alice absent this sprint
      [{ name: "Alice", donePoints: 7, totalPoints: 7, doneCount: 2, totalCount: 2 }],
      [{ name: "Alice", donePoints: 0, totalPoints: 3, doneCount: 0, totalCount: 1 }],
    ];
    const result = aggregateByAssigneeAcrossSprints(perSprint, 4);
    expect(result).toEqual([
      { name: "Alice", sprintsActive: 3, donePoints: 12, totalPoints: 18, avgDonePoints: 3 },
    ]);
  });

  it("avgDonePoints divides by the FULL sprintCount, not sprintsActive (active 2 of 4, 12 pts -> avg 3, NOT 6)", () => {
    const perSprint: AssigneeStats[][] = [
      [{ name: "Bob", donePoints: 5, totalPoints: 5, doneCount: 1, totalCount: 1 }],
      [],
      [{ name: "Bob", donePoints: 7, totalPoints: 7, doneCount: 1, totalCount: 1 }],
      [],
    ];
    const result = aggregateByAssigneeAcrossSprints(perSprint, 4);
    expect(result[0]!.sprintsActive).toBe(2);
    expect(result[0]!.donePoints).toBe(12);
    expect(result[0]!.avgDonePoints).toBe(3);
  });

  it("'Unassigned' flows through like any other name", () => {
    const perSprint: AssigneeStats[][] = [
      [{ name: "Unassigned", donePoints: 2, totalPoints: 4, doneCount: 1, totalCount: 2 }],
    ];
    const result = aggregateByAssigneeAcrossSprints(perSprint, 1);
    expect(result[0]!.name).toBe("Unassigned");
  });

  it("sorts by donePoints descending", () => {
    const perSprint: AssigneeStats[][] = [
      [
        { name: "Low", donePoints: 1, totalPoints: 10, doneCount: 1, totalCount: 1 },
        { name: "High", donePoints: 9, totalPoints: 10, doneCount: 1, totalCount: 1 },
      ],
    ];
    const result = aggregateByAssigneeAcrossSprints(perSprint, 1);
    expect(result.map((r) => r.name)).toEqual(["High", "Low"]);
  });

  it("ties on donePoints break by totalPoints desc, then name asc", () => {
    const perSprint: AssigneeStats[][] = [
      [
        { name: "Zed", donePoints: 5, totalPoints: 5, doneCount: 1, totalCount: 1 },
        { name: "Amy", donePoints: 5, totalPoints: 5, doneCount: 1, totalCount: 1 },
        { name: "Bob", donePoints: 5, totalPoints: 8, doneCount: 1, totalCount: 2 },
      ],
    ];
    const result = aggregateByAssigneeAcrossSprints(perSprint, 1);
    expect(result.map((r) => r.name)).toEqual(["Bob", "Amy", "Zed"]);
  });

  it("sprintCount 0 -> avgDonePoints is 0 (no division by zero)", () => {
    const perSprint: AssigneeStats[][] = [
      [{ name: "Alice", donePoints: 5, totalPoints: 5, doneCount: 1, totalCount: 1 }],
    ];
    const result = aggregateByAssigneeAcrossSprints(perSprint, 0);
    expect(result[0]!.avgDonePoints).toBe(0);
  });
});

// ------------------------------------------------------------------------
// C. get_multi_sprint_report — pool selection
// ------------------------------------------------------------------------

describe("get_multi_sprint_report — pool selection (default)", () => {
  it("12 closed sprints -> exactly the latest 10 selected, output chronological oldest->newest", async () => {
    const closed = Array.from({ length: 12 }, (_, i) =>
      sprintStub({
        id: i + 1,
        completeDate: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
        endDate: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
      })
    );
    api.getSprintsByState.mockImplementation((_boardId: number, state: string) =>
      Promise.resolve(state === "closed" ? closed : [])
    );
    api.getSprintIssues.mockResolvedValue([]);

    const result = await run({});

    expect(result.sprintCount).toBe(10);
    expect(result.sprints.map((s) => s.sprint.id)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(api.getSprintMeta).not.toHaveBeenCalled();
    expect(api.getSprintIssues).toHaveBeenCalledTimes(10);
  });
});

describe("get_multi_sprint_report — includeActive", () => {
  const closedX = sprintStub({ id: 101, state: "closed", completeDate: "2026-01-14T00:00:00.000Z" });
  const activeY = sprintStub({
    id: 202,
    state: "active",
    completeDate: null,
    startDate: "2026-02-01T00:00:00.000Z",
    endDate: "2026-02-14T00:00:00.000Z",
  });

  it("includeActive omitted/false ignores active sprints (no 'active' fetch at all)", async () => {
    api.getSprintsByState.mockImplementation((_boardId: number, state: string) =>
      Promise.resolve(state === "closed" ? [closedX] : [activeY])
    );
    api.getSprintIssues.mockResolvedValue([]);

    const result = await run({});

    expect(result.sprints.map((s) => s.sprint.id)).toEqual([101]);
    expect(api.getSprintsByState).toHaveBeenCalledTimes(1);
    expect(api.getSprintsByState).toHaveBeenCalledWith(expect.anything(), "closed");
  });

  it("includeActive=true pools active sprints too", async () => {
    api.getSprintsByState.mockImplementation((_boardId: number, state: string) =>
      Promise.resolve(state === "closed" ? [closedX] : [activeY])
    );
    api.getSprintIssues.mockResolvedValue([]);

    const result = await run({ includeActive: true });

    expect(result.sprints.map((s) => s.sprint.id).sort((a, b) => a - b)).toEqual([101, 202]);
    expect(api.getSprintsByState).toHaveBeenCalledTimes(2);
    expect(api.getSprintsByState).toHaveBeenCalledWith(expect.anything(), "active");
  });
});

describe("get_multi_sprint_report — beforeSprintId", () => {
  it("excludes the anchor sprint itself and anything not strictly before it", async () => {
    const before1 = sprintStub({ id: 401, completeDate: "2026-04-14T00:00:00.000Z" });
    const before2 = sprintStub({ id: 402, completeDate: "2026-05-14T00:00:00.000Z" });
    const anchorItself = sprintStub({
      id: 500,
      startDate: "2026-06-15T00:00:00.000Z",
      completeDate: "2026-06-20T00:00:00.000Z",
    });
    const afterAnchor = sprintStub({ id: 403, completeDate: "2026-06-28T00:00:00.000Z" });

    api.getSprintsByState.mockImplementation((_boardId: number, state: string) =>
      Promise.resolve(state === "closed" ? [before1, before2, anchorItself, afterAnchor] : [])
    );
    api.getSprintMeta.mockResolvedValue(
      sprintMetaStub({ id: 500, startDate: "2026-06-15T00:00:00.000Z", completeDate: null })
    );
    api.getSprintIssues.mockResolvedValue([]);

    const result = await run({ beforeSprintId: 500, sprintCount: 10 });

    const ids = result.sprints.map((s) => s.sprint.id);
    expect(ids).not.toContain(500); // the anchor sprint itself
    expect(ids).not.toContain(403); // completeDate after the anchor
    expect(ids).toEqual([401, 402]); // both before the anchor, chronological
  });
});

// ------------------------------------------------------------------------
// D. get_multi_sprint_report — explicit sprintIds
// ------------------------------------------------------------------------

describe("get_multi_sprint_report — explicit sprintIds", () => {
  it("calls getSprintMeta per id, never calls getSprintsByState, sorts chronologically by startDate", async () => {
    api.getSprintMeta.mockImplementation((id: number) =>
      Promise.resolve(
        sprintMetaStub({
          id,
          name: `Sprint ${id}`,
          startDate:
            id === 10
              ? "2026-03-01T00:00:00.000Z"
              : id === 20
                ? "2026-01-01T00:00:00.000Z"
                : "2026-02-01T00:00:00.000Z",
        })
      )
    );
    api.getSprintIssues.mockResolvedValue([]);

    const result = await run({ sprintIds: [10, 20, 30] });

    expect(api.getSprintsByState).not.toHaveBeenCalled();
    expect(api.getSprintMeta).toHaveBeenCalledTimes(3);
    expect(result.sprints.map((s) => s.sprint.id)).toEqual([20, 30, 10]); // Jan, Feb, Mar
    expect(result.sprints[0]!.sprint.boardId).toBe(10002); // meta.boardId precedent
  });
});

// ------------------------------------------------------------------------
// E. get_multi_sprint_report — mutually-exclusive validation (refine)
// ------------------------------------------------------------------------

describe("get_multi_sprint_report — sprintIds is mutually exclusive with sprintCount/beforeSprintId", () => {
  it("rejects sprintIds + sprintCount", async () => {
    await expect(run({ sprintIds: [1], sprintCount: 5 })).rejects.toThrow();
  });

  it("rejects sprintIds + beforeSprintId", async () => {
    await expect(run({ sprintIds: [1], beforeSprintId: 5 })).rejects.toThrow();
  });
});

// ------------------------------------------------------------------------
// F. get_multi_sprint_report — maxResults
// ------------------------------------------------------------------------

describe("get_multi_sprint_report — maxResults", () => {
  it("defaults to 200 when omitted", async () => {
    api.getSprintsByState.mockImplementation((_boardId: number, state: string) =>
      Promise.resolve(state === "closed" ? [sprintStub({ id: 1 })] : [])
    );
    api.getSprintIssues.mockResolvedValue([]);

    await run({});

    expect(api.getSprintIssues).toHaveBeenCalledWith(1, 200);
  });

  it("passes an explicit maxResults through", async () => {
    api.getSprintsByState.mockImplementation((_boardId: number, state: string) =>
      Promise.resolve(state === "closed" ? [sprintStub({ id: 1 })] : [])
    );
    api.getSprintIssues.mockResolvedValue([]);

    await run({ maxResults: 50 });

    expect(api.getSprintIssues).toHaveBeenCalledWith(1, 50);
  });
});

// ------------------------------------------------------------------------
// G. get_multi_sprint_report — empty window
// ------------------------------------------------------------------------

describe("get_multi_sprint_report — empty window", () => {
  it("returns the empty-but-valid zero shape when the pool is empty (not an error)", async () => {
    api.getSprintsByState.mockResolvedValue([]);

    const result = await run({});

    expect(result).toEqual({
      boardId: 10002,
      sprintCount: 0,
      sprints: [],
      totals: { committedPoints: 0, completedPoints: 0 },
      averageCompleted: 0,
      averageCompletionRate: 0,
      byAssignee: [],
    });
    expect(api.getSprintIssues).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------------
// H. get_multi_sprint_report — math parity with computeSprintPoints/computeByAssignee
// ------------------------------------------------------------------------

describe("get_multi_sprint_report — per-sprint math matches computeSprintPoints/computeByAssignee directly", () => {
  it("DoD: a 'Code Review' issue (statusCategory inprogress) counts as completed, same as get_sprint_report", async () => {
    const issues: IssueSummary[] = [
      issue({ key: "DEV-1", status: "Done", statusCategory: "done", storyPoints: 5, assignee: "Alice" }),
      issue({
        key: "DEV-2",
        status: "Code Review",
        statusCategory: "inprogress",
        storyPoints: 3,
        assignee: "Bob",
      }),
      issue({
        key: "DEV-3",
        status: "To Do",
        statusCategory: "todo",
        storyPoints: 2,
        assignee: "Alice",
        blocked: true,
      }),
    ];
    api.getSprintsByState.mockImplementation((_boardId: number, state: string) =>
      Promise.resolve(state === "closed" ? [sprintStub({ id: 1 })] : [])
    );
    api.getSprintIssues.mockResolvedValue(issues);

    const result = await run({});
    const entry = result.sprints[0]!;

    const isDone = makeDodPredicate("code review,in review,peer review,review");
    const expectedPoints = computeSprintPoints(issues, isDone);
    const expectedByAssignee = computeByAssignee(issues, isDone);

    expect(entry.committedPoints).toBe(expectedPoints.committedPoints);
    expect(entry.completedPoints).toBe(expectedPoints.completedPoints);
    expect(entry.completionRate).toBeCloseTo(expectedPoints.completionRate);
    expect(entry.totalCount).toBe(3);
    expect(entry.completedCount).toBe(2); // DEV-1 (done) + DEV-2 (code review)
    expect(entry.carryoverCount).toBe(1);
    expect(entry.blockedCount).toBe(1);
    expect(entry.byAssignee).toEqual(expectedByAssignee);
  });
});

// ------------------------------------------------------------------------
// I. get_multi_sprint_report — window totals/averages
// ------------------------------------------------------------------------

describe("get_multi_sprint_report — window totals/averageCompleted/averageCompletionRate", () => {
  it("sums totals and averages correctly over a 3-sprint window", async () => {
    const sprints = [
      sprintStub({ id: 1, completeDate: "2026-01-14T00:00:00.000Z" }),
      sprintStub({ id: 2, completeDate: "2026-02-14T00:00:00.000Z" }),
      sprintStub({ id: 3, completeDate: "2026-03-14T00:00:00.000Z" }),
    ];
    api.getSprintsByState.mockImplementation((_boardId: number, state: string) =>
      Promise.resolve(state === "closed" ? sprints : [])
    );
    // Chronological fetch order (oldest first): sprint 1, then 2, then 3.
    api.getSprintIssues
      .mockResolvedValueOnce([issue({ statusCategory: "done", storyPoints: 5 })]) // sprint 1
      .mockResolvedValueOnce([
        issue({ statusCategory: "done", storyPoints: 3 }),
        issue({ statusCategory: "todo", storyPoints: 1 }),
      ]) // sprint 2
      .mockResolvedValueOnce([issue({ statusCategory: "done", storyPoints: 7 })]); // sprint 3

    const result = await run({});

    expect(result.sprints.map((s) => s.sprint.id)).toEqual([1, 2, 3]);
    // committed: 5 + (3+1) + 7 = 16; completed: 5 + 3 + 7 = 15
    expect(result.totals).toEqual({ committedPoints: 16, completedPoints: 15 });
    expect(result.averageCompleted).toBeCloseTo(5); // 15 / 3
    // completionRate per sprint: 5/5=1, 3/4=0.75, 7/7=1 -> mean
    expect(result.averageCompletionRate).toBeCloseTo((1 + 0.75 + 1) / 3);
  });
});
