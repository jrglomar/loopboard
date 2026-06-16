// reportMarkdown.ts unit tests — ADR-012, ADR-013 v1.4.1
// Pure function; no mocks needed. Keyless/offline.

import { describe, it, expect } from "vitest";
import { buildReportMarkdown } from "./reportMarkdown";
import type { SprintReport, VelocityData } from "./types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_REPORT: SprintReport = {
  sprint: {
    id: 54,
    name: "Sprint 6",
    state: "closed",
    startDate: "2026-05-12T00:00:00.000Z",
    endDate: "2026-05-25T00:00:00.000Z",
    completeDate: "2026-05-25T17:00:00.000Z",
    goal: "Ship auth flow",
    boardId: 1,
  },
  committedPoints: 40,
  completedPoints: 32,
  completionRate: 0.8,
  totalCount: 10,
  completedCount: 8,
  carryoverCount: 2,
  blockedCount: 0,
  completed: [
    {
      key: "DEV-1",
      summary: "Implement login",
      status: "Done",
      statusCategory: "done",
      assignee: "Alice",
      assigneeAccountId: null,
      storyPoints: 8,
      issueType: "Story",
      url: "https://jira.example.com/browse/DEV-1",
      blocked: false,
    },
    {
      key: "DEV-2",
      summary: "Update DB schema",
      status: "Done",
      statusCategory: "done",
      assignee: "Bob",
      assigneeAccountId: null,
      storyPoints: 5,
      issueType: "Task",
      url: "https://jira.example.com/browse/DEV-2",
      blocked: false,
    },
  ],
  notCompleted: [
    {
      key: "DEV-9",
      summary: "Pending review",
      status: "In Progress",
      statusCategory: "inprogress",
      assignee: "Bob",
      assigneeAccountId: null,
      storyPoints: 5,
      issueType: "Task",
      url: "https://jira.example.com/browse/DEV-9",
      blocked: false,
    },
  ],
  byAssignee: [
    { name: "Alice", donePoints: 8, totalPoints: 13, doneCount: 1, totalCount: 2 },
    { name: "Bob", donePoints: 5, totalPoints: 10, doneCount: 1, totalCount: 2 },
  ],
};

const BASE_VELOCITY: VelocityData = {
  boardId: 1,
  sprintCount: 3,
  sprints: [
    { id: 50, name: "Sprint 4", committedPoints: 30, completedPoints: 28, completeDate: "2026-04-28T00:00:00.000Z" },
    { id: 52, name: "Sprint 5", committedPoints: 35, completedPoints: 30, completeDate: "2026-05-12T00:00:00.000Z" },
    { id: 54, name: "Sprint 6", committedPoints: 40, completedPoints: 36, completeDate: "2026-05-26T00:00:00.000Z" },
  ],
  averageCompleted: 31.333333,
  forecastNext: 31.333333,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("buildReportMarkdown — title section", () => {
  it("includes sprint name in H1 heading", () => {
    const md = buildReportMarkdown(BASE_REPORT);
    expect(md).toContain("# Sprint Report: Sprint 6");
  });

  it("includes date range (YYYY-MM-DD format)", () => {
    const md = buildReportMarkdown(BASE_REPORT);
    expect(md).toContain("2026-05-12");
    expect(md).toContain("2026-05-25");
  });

  it("includes sprint state", () => {
    const md = buildReportMarkdown(BASE_REPORT);
    expect(md).toContain("**State:** closed");
  });

  it("includes goal when present", () => {
    const md = buildReportMarkdown(BASE_REPORT);
    expect(md).toContain("**Goal:** Ship auth flow");
  });

  it("omits goal line when sprint.goal is null", () => {
    const noGoal: SprintReport = {
      ...BASE_REPORT,
      sprint: { ...BASE_REPORT.sprint, goal: null },
    };
    const md = buildReportMarkdown(noGoal);
    expect(md).not.toContain("**Goal:**");
  });
});

describe("buildReportMarkdown — completion summary (points-focused, ADR-013)", () => {
  it("includes committed and completed points", () => {
    const md = buildReportMarkdown(BASE_REPORT);
    expect(md).toContain("| Committed points | 40 |");
    expect(md).toContain("| Completed points | 32 |");
  });

  it("includes completion rate as %", () => {
    const md = buildReportMarkdown(BASE_REPORT);
    expect(md).toContain("| Completion rate | 80% |");
  });

  it("includes carryover as points (committed − completed = 8)", () => {
    const md = buildReportMarkdown(BASE_REPORT);
    expect(md).toContain("| Carryover points | 8 |");
  });

  it("does NOT include issues done/total metric row", () => {
    const md = buildReportMarkdown(BASE_REPORT);
    // The old row "| Issues done | X / Y |" must be gone
    expect(md).not.toContain("Issues done");
  });

  it("omits blocked row when blockedCount is 0", () => {
    const md = buildReportMarkdown(BASE_REPORT); // blockedCount: 0
    expect(md).not.toContain("| Blocked |");
  });

  it("shows blocked row when blockedCount > 0", () => {
    const withBlocked: SprintReport = { ...BASE_REPORT, blockedCount: 2 };
    const md = buildReportMarkdown(withBlocked);
    expect(md).toContain("| Blocked | 2 issues");
  });
});

describe("buildReportMarkdown — by-assignee table (points only, ADR-013)", () => {
  it("by-assignee table has name, done pts, total pts columns only", () => {
    const md = buildReportMarkdown(BASE_REPORT);
    expect(md).toContain("| Assignee | Done pts | Total pts |");
  });

  it("does NOT include done-issues or total-issues columns", () => {
    const md = buildReportMarkdown(BASE_REPORT);
    expect(md).not.toContain("Done issues");
    expect(md).not.toContain("Total issues");
  });

  it("renders assignee rows with formatted point values", () => {
    const md = buildReportMarkdown(BASE_REPORT);
    expect(md).toContain("| Alice | 8 | 13 |");
    expect(md).toContain("| Bob | 5 | 10 |");
  });

  it("renders empty assignee message when byAssignee is empty", () => {
    const noAssignee: SprintReport = { ...BASE_REPORT, byAssignee: [] };
    const md = buildReportMarkdown(noAssignee);
    expect(md).toContain("_No assignee data._");
  });
});

describe("buildReportMarkdown — issue lists", () => {
  it("lists completed issues with key links and points", () => {
    const md = buildReportMarkdown(BASE_REPORT);
    expect(md).toContain("[DEV-1](https://jira.example.com/browse/DEV-1)");
    expect(md).toContain("Implement login");
    expect(md).toContain("(8 pts)");
  });

  it("lists carryover issues with blocked flag when applicable", () => {
    const withBlocked: SprintReport = {
      ...BASE_REPORT,
      notCompleted: [
        {
          ...BASE_REPORT.notCompleted[0],
          blocked: true,
        },
      ],
    };
    const md = buildReportMarkdown(withBlocked);
    expect(md).toContain("[DEV-9]");
    expect(md).toContain("**[BLOCKED]**");
  });

  it("renders empty completed message when completed is empty", () => {
    const noCompleted: SprintReport = { ...BASE_REPORT, completed: [] };
    const md = buildReportMarkdown(noCompleted);
    expect(md).toContain("_No completed issues._");
  });

  it("renders empty carryover message when notCompleted is empty", () => {
    const noCarryover: SprintReport = { ...BASE_REPORT, notCompleted: [] };
    const md = buildReportMarkdown(noCarryover);
    expect(md).toContain("_No carryover issues._");
  });
});

describe("buildReportMarkdown — decimal formatting (ADR-013)", () => {
  it("formats decimal point values to at most 2 places, trailing zeros trimmed", () => {
    const decimalReport: SprintReport = {
      ...BASE_REPORT,
      committedPoints: 13.5,
      completedPoints: 10.333333,
      byAssignee: [
        { name: "Alice", donePoints: 8.75, totalPoints: 13.333333, doneCount: 1, totalCount: 2 },
      ],
    };
    const md = buildReportMarkdown(decimalReport);
    // Committed: 13.5
    expect(md).toContain("| Committed points | 13.5 |");
    // Completed: 10.33 (truncated)
    expect(md).toContain("| Completed points | 10.33 |");
    // By-assignee: 8.75 and 13.33
    expect(md).toContain("| Alice | 8.75 | 13.33 |");
  });
});

describe("buildReportMarkdown — velocity section", () => {
  it("includes velocity section when velocity has sprints", () => {
    const md = buildReportMarkdown(BASE_REPORT, BASE_VELOCITY);
    expect(md).toContain("## Velocity");
    expect(md).toContain("Sprint 4");
    expect(md).toContain("Sprint 5");
  });

  it("formats velocity averageCompleted with formatPoints", () => {
    const md = buildReportMarkdown(BASE_REPORT, BASE_VELOCITY);
    // 31.333333 → "31.33"
    expect(md).toContain("31.33 pts");
  });

  it("formats velocity sprint points with formatPoints", () => {
    const md = buildReportMarkdown(BASE_REPORT, BASE_VELOCITY);
    expect(md).toContain("| Sprint 4 | 30 | 28 |");
  });

  it("omits velocity section when velocity is null", () => {
    const md = buildReportMarkdown(BASE_REPORT, null);
    expect(md).not.toContain("## Velocity");
  });

  it("omits velocity section when velocity.sprints is empty", () => {
    const emptyVelocity: VelocityData = {
      ...BASE_VELOCITY,
      sprints: [],
      averageCompleted: 0,
      forecastNext: 0,
    };
    const md = buildReportMarkdown(BASE_REPORT, emptyVelocity);
    expect(md).not.toContain("## Velocity");
  });

  it("includes heuristic caveat in velocity section", () => {
    const md = buildReportMarkdown(BASE_REPORT, BASE_VELOCITY);
    expect(md).toContain("not a commitment");
  });
});

describe("buildReportMarkdown — AI summary section", () => {
  it("includes AI summary section when aiSummary is provided", () => {
    const md = buildReportMarkdown(BASE_REPORT, null, "The team did great.");
    expect(md).toContain("## AI Executive Summary");
    expect(md).toContain("The team did great.");
  });

  it("omits AI summary section when aiSummary is null", () => {
    const md = buildReportMarkdown(BASE_REPORT, null, null);
    expect(md).not.toContain("## AI Executive Summary");
  });
});

// ── v1.5 (ADR-016): Leaves & capacity section ────────────────────────────────

import type { LeavesCapacityData } from "./reportMarkdown";

const BASE_LEAVES_CAPACITY: LeavesCapacityData = {
  byAssigneeLeaveDays: { Alice: 2, Bob: 0 },
  leavePersonDays: 2,
  capacityFactor: 0.8,
  possibleCommittedVelocity: 25.6,
  averageCompleted: 32,
  workingDayCount: 10,
};

describe("buildReportMarkdown — leaves & capacity section (v1.5)", () => {
  it("includes Leaves & Capacity section when leavesCapacity is provided", () => {
    const md = buildReportMarkdown(BASE_REPORT, null, null, BASE_LEAVES_CAPACITY);
    expect(md).toContain("## Leaves & Capacity");
  });

  it("shows per-assignee leave days in the Leaves & Capacity section", () => {
    const md = buildReportMarkdown(BASE_REPORT, null, null, BASE_LEAVES_CAPACITY);
    expect(md).toContain("2 working day(s) off");
  });

  it("includes possible committed velocity line labeled as heuristic", () => {
    const md = buildReportMarkdown(BASE_REPORT, null, null, BASE_LEAVES_CAPACITY);
    expect(md).toContain("Possible committed velocity");
    expect(md).toContain("heuristic, not a commitment");
  });

  it("includes capacity % in the possible velocity line", () => {
    const md = buildReportMarkdown(BASE_REPORT, null, null, BASE_LEAVES_CAPACITY);
    // 0.8 → 80%
    expect(md).toContain("80%");
  });

  it("includes formatted possible velocity using formatPoints", () => {
    const md = buildReportMarkdown(BASE_REPORT, null, null, BASE_LEAVES_CAPACITY);
    // 25.6 → "25.6"
    expect(md).toContain("25.6 pts");
  });

  it("shows 'no leaves recorded' when leavePersonDays is 0", () => {
    const noLeaves: LeavesCapacityData = {
      ...BASE_LEAVES_CAPACITY,
      byAssigneeLeaveDays: { Alice: 0, Bob: 0 },
      leavePersonDays: 0,
      capacityFactor: 1,
      possibleCommittedVelocity: 32,
    };
    const md = buildReportMarkdown(BASE_REPORT, null, null, noLeaves);
    expect(md).toContain("No leaves recorded");
  });

  it("omits Leaves & Capacity section when leavesCapacity is null", () => {
    const md = buildReportMarkdown(BASE_REPORT, null, null, null);
    expect(md).not.toContain("## Leaves & Capacity");
  });

  it("omits Leaves & Capacity section when leavesCapacity is not provided", () => {
    const md = buildReportMarkdown(BASE_REPORT);
    expect(md).not.toContain("## Leaves & Capacity");
  });

  it("adds Leaves column to by-assignee table when leavesCapacity is provided", () => {
    const md = buildReportMarkdown(BASE_REPORT, null, null, BASE_LEAVES_CAPACITY);
    expect(md).toContain("| Assignee | Done pts | Total pts | Leaves |");
    expect(md).toContain("| Alice | 8 | 13 | 2 days |");
    expect(md).toContain("| Bob | 5 | 10 | — |");
  });

  it("by-assignee table has NO Leaves column when leavesCapacity is omitted", () => {
    const md = buildReportMarkdown(BASE_REPORT);
    expect(md).toContain("| Assignee | Done pts | Total pts |");
    expect(md).not.toContain("| Leaves |");
  });
});
