/**
 * v1.5 feature tests — DoD, velocity context, leaves store + tools.
 *
 * All tests run keyless and offline:
 * - jiraClient is vi.mocked (no network)
 * - leavesStore uses a temp file via JIRA_LEAVES_FILE env override
 *
 * Covers:
 * A. DoD = done OR code review (ADR-014)
 *    - reportMath: makeDodPredicate, computeSprintPoints, computeByAssignee
 *    - getSprintReport: completedPoints/completedCount/byAssignee, carryover excludes code review
 *    - getVelocity: per-sprint completedPoints includes code review
 *    - getSprint (get_active_sprint): storyPointsCodeReview correct, storyPointsDone unchanged
 * B. get_velocity beforeSprintId (ADR-015)
 *    - Only sprints before the selected one are included
 *    - Selected sprint itself is excluded
 *    - Empty window → zeros
 *    - Omitted → latest-N unchanged
 * C. Leaves store + tools (ADR-016)
 *    - set→get round-trip
 *    - Replace overwrites
 *    - Empty dates clears assignee
 *    - Date format validation rejects bad dates
 *    - Missing file tolerated (get returns {})
 *    - Tests use a unique temp file per test via JIRA_LEAVES_FILE
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type MockedObject,
} from "vitest";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import { resetConfigCache } from "../src/lib/config.js";
import {
  makeDodPredicate,
  computeSprintPoints,
  computeByAssignee,
} from "../src/lib/reportMath.js";
import type { IssueSummary } from "../src/lib/types.js";

// ---- Mock jiraClient before importing tools ----
vi.mock("../src/lib/jiraClient.js", () => ({
  createIssue: vi.fn(),
  createIssueLink: vi.fn(),
  addIssuesToSprint: vi.fn(),
  getActiveSprints: vi.fn(),
  getActiveAndFutureSprints: vi.fn(),
  getSprintIssues: vi.fn(),
  getSprintIssuesRaw: vi.fn(),
  getSprintsByState: vi.fn(),
  getSprintMeta: vi.fn(),
  createSprint: vi.fn(),
  getIssue: vi.fn(),
  updateIssue: vi.fn(),
  isBlocked: vi.fn(),
  mapIssue: vi.fn(),
  resetClientCache: vi.fn(),
}));

import * as jiraClient from "../src/lib/jiraClient.js";
import { getSprint } from "../src/tools/getSprint.js";
import { getSprintReportTool } from "../src/tools/getSprintReport.js";
import { getVelocityTool } from "../src/tools/getVelocity.js";
import { getLeavesTool } from "../src/tools/getLeaves.js";
import { setLeavesTool } from "../src/tools/setLeaves.js";

const client = jiraClient as MockedObject<typeof jiraClient>;

// ---- Env setup ----

function setRequiredEnv() {
  process.env["JIRA_BASE_URL"] = "https://test.atlassian.net";
  process.env["JIRA_EMAIL"] = "test@example.com";
  process.env["JIRA_API_TOKEN"] = "test-token";
  process.env["JIRA_PO_BOARD_ID"] = "10001";
  process.env["JIRA_DEV_BOARD_ID"] = "10002";
  process.env["JIRA_PO_PROJECT_KEY"] = "PO";
  process.env["JIRA_DEV_PROJECT_KEY"] = "DEV";
  process.env["JIRA_STORY_POINTS_FIELD"] = "customfield_10016";
  process.env["JIRA_LINK_TYPE"] = "Relates";
  process.env["JIRA_FLAGGED_FIELD"] = "";
  // Default code review statuses
  process.env["JIRA_CODE_REVIEW_STATUSES"] =
    "code review,in review,peer review,review";
}

const originalEnv = { ...process.env };

// Per-test temp file path — set before each test that uses leaves
let tempLeavesFile: string | null = null;

beforeEach(() => {
  resetConfigCache();
  setRequiredEnv();
  vi.clearAllMocks();
  // Point JIRA_LEAVES_FILE at a unique temp file so tests don't touch the real default
  tempLeavesFile = path.join(
    os.tmpdir(),
    `loopboard-leaves-test-${process.pid}-${Date.now()}.json`
  );
  process.env["JIRA_LEAVES_FILE"] = tempLeavesFile;
  resetConfigCache(); // pick up JIRA_LEAVES_FILE
});

afterEach(() => {
  // Clean up temp file if it was created
  if (tempLeavesFile !== null) {
    try {
      fs.unlinkSync(tempLeavesFile);
    } catch {
      // File may not exist if the test never wrote; that's fine
    }
    tempLeavesFile = null;
  }
  // Restore env
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
  resetConfigCache();
  vi.unstubAllGlobals();
});

// ---- Issue fixture ----

function makeIssue(overrides: Partial<IssueSummary> = {}): IssueSummary {
  return {
    key: "DEV-1",
    summary: "Fix bug",
    status: "In Progress",
    statusCategory: "inprogress",
    assignee: "Alice",
    assigneeAccountId: null,
    storyPoints: 3,
    issueType: "Task",
    url: "https://test.atlassian.net/browse/DEV-1",
    blocked: false,
    ...overrides,
  };
}

// ---- Sprint fixtures for velocity tests ----

const closedSprintA = {
  id: 50,
  name: "Sprint 5",
  state: "closed",
  startDate: "2026-04-01T00:00:00.000Z",
  endDate: "2026-04-14T00:00:00.000Z",
  completeDate: "2026-04-14T00:00:00.000Z",
  goal: null,
};
const closedSprintB = {
  id: 51,
  name: "Sprint 6",
  state: "closed",
  startDate: "2026-05-01T00:00:00.000Z",
  endDate: "2026-05-14T00:00:00.000Z",
  completeDate: "2026-05-14T00:00:00.000Z",
  goal: null,
};
const closedSprintC = {
  id: 52,
  name: "Sprint 7",
  state: "closed",
  startDate: "2026-06-01T00:00:00.000Z",
  endDate: "2026-06-14T00:00:00.000Z",
  completeDate: "2026-06-14T00:00:00.000Z",
  goal: null,
};
// Sprint meta returned by getSprintMeta for beforeSprintId=55
// startDate is the anchor: only closed sprints with completeDate < "2026-06-15" qualify.
const sprintMeta = {
  id: 55,
  name: "Sprint 8",
  state: "active",
  startDate: "2026-06-15T00:00:00.000Z",
  endDate: "2026-06-28T00:00:00.000Z",
  completeDate: null,
  goal: "Ship it",
  boardId: 10002,
};

// ========================================================================
// A. reportMath — makeDodPredicate, computeSprintPoints, computeByAssignee
// ========================================================================

describe("makeDodPredicate (v1.5 ADR-014)", () => {
  const raw = "code review,in review,peer review,review";

  it("returns true for a done issue", () => {
    const pred = makeDodPredicate(raw);
    expect(pred(makeIssue({ statusCategory: "done", status: "Done" }))).toBe(true);
  });

  it("returns true for an inprogress issue with a matching code-review status", () => {
    const pred = makeDodPredicate(raw);
    expect(pred(makeIssue({ statusCategory: "inprogress", status: "Code Review" }))).toBe(true);
    expect(pred(makeIssue({ statusCategory: "inprogress", status: "In Review" }))).toBe(true);
    expect(pred(makeIssue({ statusCategory: "inprogress", status: "Peer Review" }))).toBe(true);
    expect(pred(makeIssue({ statusCategory: "inprogress", status: "Review" }))).toBe(true);
  });

  it("returns false for an inprogress issue NOT in code review", () => {
    const pred = makeDodPredicate(raw);
    expect(pred(makeIssue({ statusCategory: "inprogress", status: "In Progress" }))).toBe(false);
  });

  it("returns false for a todo issue (even if status text matches)", () => {
    const pred = makeDodPredicate(raw);
    expect(pred(makeIssue({ statusCategory: "todo", status: "Code Review" }))).toBe(false);
  });

  it("handles case-insensitive + trim in status", () => {
    const pred = makeDodPredicate(raw);
    expect(pred(makeIssue({ statusCategory: "inprogress", status: "  CODE REVIEW  " }))).toBe(true);
  });
});

describe("computeSprintPoints with DoD predicate (v1.5)", () => {
  const raw = "code review,in review,peer review,review";

  it("counts done issues AND code-review issues as completed", () => {
    const isDone = makeDodPredicate(raw);
    const issues = [
      makeIssue({ key: "DEV-1", statusCategory: "done", storyPoints: 5 }),
      makeIssue({ key: "DEV-2", statusCategory: "inprogress", status: "Code Review", storyPoints: 3 }),
      makeIssue({ key: "DEV-3", statusCategory: "inprogress", status: "In Progress", storyPoints: 2 }),
      makeIssue({ key: "DEV-4", statusCategory: "todo", storyPoints: 1 }),
    ];
    const { committedPoints, completedPoints, completionRate } = computeSprintPoints(issues, isDone);
    // committed = 5+3+2+1 = 11
    expect(committedPoints).toBe(11);
    // completed = 5 (done) + 3 (code review) = 8
    expect(completedPoints).toBe(8);
    expect(completionRate).toBeCloseTo(8 / 11);
  });

  it("legacy behavior (no predicate) counts only done", () => {
    const issues = [
      makeIssue({ key: "DEV-1", statusCategory: "done", storyPoints: 5 }),
      makeIssue({ key: "DEV-2", statusCategory: "inprogress", status: "Code Review", storyPoints: 3 }),
    ];
    const { completedPoints } = computeSprintPoints(issues);
    expect(completedPoints).toBe(5); // code review NOT counted without predicate
  });
});

describe("computeByAssignee with DoD predicate (v1.5)", () => {
  const raw = "code review,in review,peer review,review";

  it("donePoints includes code-review issues", () => {
    const isDone = makeDodPredicate(raw);
    const issues = [
      makeIssue({ key: "DEV-1", assignee: "Alice", statusCategory: "done", storyPoints: 5 }),
      makeIssue({ key: "DEV-2", assignee: "Alice", statusCategory: "inprogress", status: "Code Review", storyPoints: 3 }),
      makeIssue({ key: "DEV-3", assignee: "Alice", statusCategory: "inprogress", status: "In Progress", storyPoints: 2 }),
    ];
    const result = computeByAssignee(issues, isDone);
    const alice = result.find((a) => a.name === "Alice");
    expect(alice).toBeDefined();
    expect(alice!.donePoints).toBe(8); // 5 done + 3 code review
    expect(alice!.doneCount).toBe(2);
    expect(alice!.totalPoints).toBe(10);
    expect(alice!.totalCount).toBe(3);
  });

  it("legacy behavior (no predicate) counts only done in donePoints", () => {
    const issues = [
      makeIssue({ key: "DEV-1", assignee: "Alice", statusCategory: "done", storyPoints: 5 }),
      makeIssue({ key: "DEV-2", assignee: "Alice", statusCategory: "inprogress", status: "Code Review", storyPoints: 3 }),
    ];
    const result = computeByAssignee(issues);
    const alice = result.find((a) => a.name === "Alice");
    expect(alice!.donePoints).toBe(5); // only done
  });
});

// ========================================================================
// A. getSprintReport — DoD includes code review (ADR-014)
// ========================================================================

const sprintMetaReport = {
  id: 55,
  name: "Sprint 7",
  state: "active",
  startDate: "2026-06-01T00:00:00.000Z",
  endDate: "2026-06-14T00:00:00.000Z",
  completeDate: null,
  goal: "Ship it",
  boardId: 10002,
};

describe("get_sprint_report DoD v1.5 (ADR-014)", () => {
  it("counts a code-review issue as completed", async () => {
    client.getSprintMeta.mockResolvedValueOnce(sprintMetaReport);
    client.getSprintIssues.mockResolvedValueOnce([
      makeIssue({ key: "DEV-1", statusCategory: "done", storyPoints: 5 }),
      makeIssue({
        key: "DEV-2",
        statusCategory: "inprogress",
        status: "Code Review",
        storyPoints: 3,
      }),
      makeIssue({ key: "DEV-3", statusCategory: "inprogress", status: "In Progress", storyPoints: 2 }),
      makeIssue({ key: "DEV-4", statusCategory: "todo", storyPoints: 1 }),
    ]);

    const result = await getSprintReportTool.handler({ sprintId: 55 }) as {
      completed: { key: string }[];
      notCompleted: { key: string }[];
      committedPoints: number;
      completedPoints: number;
      completionRate: number;
      completedCount: number;
      carryoverCount: number;
    };

    // DEV-1 (done) + DEV-2 (code review) both in completed
    expect(result.completed.map((i) => i.key)).toContain("DEV-1");
    expect(result.completed.map((i) => i.key)).toContain("DEV-2");
    expect(result.completedCount).toBe(2);

    // DEV-3 and DEV-4 are carryover
    expect(result.notCompleted.map((i) => i.key)).toContain("DEV-3");
    expect(result.notCompleted.map((i) => i.key)).toContain("DEV-4");
    expect(result.carryoverCount).toBe(2);

    // Points: committed = 5+3+2+1=11, completed = 5+3=8
    expect(result.committedPoints).toBe(11);
    expect(result.completedPoints).toBe(8);
    expect(result.completionRate).toBeCloseTo(8 / 11);
  });

  it("carryover does NOT include code-review issue", async () => {
    client.getSprintMeta.mockResolvedValueOnce(sprintMetaReport);
    client.getSprintIssues.mockResolvedValueOnce([
      makeIssue({
        key: "DEV-1",
        statusCategory: "inprogress",
        status: "Code Review",
        storyPoints: 5,
      }),
    ]);

    const result = await getSprintReportTool.handler({ sprintId: 55 }) as {
      completed: { key: string }[];
      notCompleted: { key: string }[];
      completedPoints: number;
    };

    expect(result.completed.map((i) => i.key)).toContain("DEV-1");
    expect(result.notCompleted).toHaveLength(0);
    expect(result.completedPoints).toBe(5);
  });

  it("byAssignee donePoints includes code-review issues", async () => {
    client.getSprintMeta.mockResolvedValueOnce(sprintMetaReport);
    client.getSprintIssues.mockResolvedValueOnce([
      makeIssue({ key: "DEV-1", assignee: "Bob", statusCategory: "done", storyPoints: 5 }),
      makeIssue({
        key: "DEV-2",
        assignee: "Bob",
        statusCategory: "inprogress",
        status: "Code Review",
        storyPoints: 3,
      }),
      makeIssue({
        key: "DEV-3",
        assignee: "Bob",
        statusCategory: "inprogress",
        status: "In Progress",
        storyPoints: 2,
      }),
    ]);

    const result = await getSprintReportTool.handler({ sprintId: 55 }) as {
      byAssignee: { name: string; donePoints: number; doneCount: number; totalPoints: number }[];
    };

    const bob = result.byAssignee.find((a) => a.name === "Bob");
    expect(bob).toBeDefined();
    expect(bob!.donePoints).toBe(8); // done + code review
    expect(bob!.doneCount).toBe(2);
    expect(bob!.totalPoints).toBe(10);
  });
});

// ========================================================================
// A. getSprint (get_active_sprint) — storyPointsCodeReview v1.5
// ========================================================================

const activeSprint = {
  id: 55,
  name: "Sprint 7",
  state: "active",
  startDate: "2026-06-01T00:00:00.000Z",
  endDate: "2026-06-14T00:00:00.000Z",
  goal: "Ship it",
};

describe("get_active_sprint totals.storyPointsCodeReview (v1.5 ADR-014)", () => {
  it("storyPointsCodeReview is the sum of codereview bucket points", async () => {
    client.getActiveAndFutureSprints.mockResolvedValueOnce([activeSprint]);
    client.getSprintIssues.mockResolvedValueOnce([
      makeIssue({ key: "DEV-1", statusCategory: "done", storyPoints: 5 }),
      makeIssue({
        key: "DEV-2",
        statusCategory: "inprogress",
        status: "Code Review",
        storyPoints: 3,
      }),
      makeIssue({
        key: "DEV-3",
        statusCategory: "inprogress",
        status: "In Progress",
        storyPoints: 2,
      }),
    ]);

    const result = await getSprint.handler({}) as {
      totals: {
        storyPointsDone: number;
        storyPointsCodeReview: number;
        storyPointsTotal: number;
      };
    };

    // storyPointsDone: strictly the done bucket (5)
    expect(result.totals.storyPointsDone).toBe(5);
    // storyPointsCodeReview: code review bucket (3)
    expect(result.totals.storyPointsCodeReview).toBe(3);
    // storyPointsTotal: all (5+3+2=10)
    expect(result.totals.storyPointsTotal).toBe(10);
  });

  it("storyPointsCodeReview is 0 when no code-review issues exist", async () => {
    client.getActiveAndFutureSprints.mockResolvedValueOnce([activeSprint]);
    client.getSprintIssues.mockResolvedValueOnce([
      makeIssue({ key: "DEV-1", statusCategory: "done", storyPoints: 5 }),
      makeIssue({ key: "DEV-2", statusCategory: "inprogress", status: "In Progress", storyPoints: 3 }),
    ]);

    const result = await getSprint.handler({}) as {
      totals: { storyPointsDone: number; storyPointsCodeReview: number };
    };

    expect(result.totals.storyPointsDone).toBe(5);
    expect(result.totals.storyPointsCodeReview).toBe(0);
  });

  it("storyPointsDone is unchanged (only done bucket, NOT code review)", async () => {
    client.getActiveAndFutureSprints.mockResolvedValueOnce([activeSprint]);
    client.getSprintIssues.mockResolvedValueOnce([
      makeIssue({
        key: "DEV-1",
        statusCategory: "inprogress",
        status: "Code Review",
        storyPoints: 8,
      }),
    ]);

    const result = await getSprint.handler({}) as {
      totals: { storyPointsDone: number; storyPointsCodeReview: number };
    };

    // Code review issue is NOT in done bucket → storyPointsDone stays 0
    expect(result.totals.storyPointsDone).toBe(0);
    expect(result.totals.storyPointsCodeReview).toBe(8);
  });

  it("storyPointsCodeReview sums multiple code-review issues", async () => {
    client.getActiveAndFutureSprints.mockResolvedValueOnce([activeSprint]);
    client.getSprintIssues.mockResolvedValueOnce([
      makeIssue({ key: "DEV-1", statusCategory: "inprogress", status: "Code Review", storyPoints: 3 }),
      makeIssue({ key: "DEV-2", statusCategory: "inprogress", status: "In Review", storyPoints: 5 }),
      makeIssue({ key: "DEV-3", statusCategory: "inprogress", status: "Peer Review", storyPoints: 2 }),
    ]);

    const result = await getSprint.handler({}) as {
      totals: { storyPointsCodeReview: number };
    };

    expect(result.totals.storyPointsCodeReview).toBe(10); // 3+5+2
  });

  it("storyPointsCodeReview treats null storyPoints as 0", async () => {
    client.getActiveAndFutureSprints.mockResolvedValueOnce([activeSprint]);
    client.getSprintIssues.mockResolvedValueOnce([
      makeIssue({ key: "DEV-1", statusCategory: "inprogress", status: "Code Review", storyPoints: null }),
      makeIssue({ key: "DEV-2", statusCategory: "inprogress", status: "Code Review", storyPoints: 3 }),
    ]);

    const result = await getSprint.handler({}) as {
      totals: { storyPointsCodeReview: number };
    };

    expect(result.totals.storyPointsCodeReview).toBe(3);
  });
});

// ========================================================================
// A. getVelocity — DoD includes code review (ADR-014)
// ========================================================================

describe("get_velocity DoD v1.5 (ADR-014)", () => {
  it("per-sprint completedPoints includes code-review issues", async () => {
    client.getSprintsByState.mockResolvedValueOnce([closedSprintA]);
    client.getSprintIssues.mockResolvedValueOnce([
      makeIssue({ key: "DEV-1", statusCategory: "done", storyPoints: 5 }),
      makeIssue({
        key: "DEV-2",
        statusCategory: "inprogress",
        status: "Code Review",
        storyPoints: 3,
      }),
      makeIssue({ key: "DEV-3", statusCategory: "todo", storyPoints: 2 }),
    ]);

    const result = await getVelocityTool.handler({ sprintCount: 1 }) as {
      sprints: { id: number; committedPoints: number; completedPoints: number }[];
      averageCompleted: number;
    };

    expect(result.sprints).toHaveLength(1);
    expect(result.sprints[0]!.committedPoints).toBe(10); // 5+3+2
    expect(result.sprints[0]!.completedPoints).toBe(8); // done + code review
    expect(result.averageCompleted).toBeCloseTo(8);
  });

  it("averageCompleted reflects code-review DoD across multiple sprints", async () => {
    client.getSprintsByState.mockResolvedValueOnce([closedSprintB, closedSprintA]); // latest-first
    // Sprint B (latest, fetched first): 4 done + 2 code review = 6 completed
    client.getSprintIssues
      .mockResolvedValueOnce([
        makeIssue({ key: "DEV-1", statusCategory: "done", storyPoints: 4 }),
        makeIssue({ key: "DEV-2", statusCategory: "inprogress", status: "Code Review", storyPoints: 2 }),
      ])
      // Sprint A (older): 3 done + 0 code review = 3 completed
      .mockResolvedValueOnce([
        makeIssue({ key: "DEV-3", statusCategory: "done", storyPoints: 3 }),
      ]);

    const result = await getVelocityTool.handler({ sprintCount: 2 }) as {
      sprints: { id: number; completedPoints: number }[];
      averageCompleted: number;
    };

    // Chronological order: A (50) then B (51)
    expect(result.sprints[0]!.id).toBe(50);
    expect(result.sprints[0]!.completedPoints).toBe(3);
    expect(result.sprints[1]!.id).toBe(51);
    expect(result.sprints[1]!.completedPoints).toBe(6);
    // Average: (3 + 6) / 2 = 4.5
    expect(result.averageCompleted).toBeCloseTo(4.5);
  });
});

// ========================================================================
// B. get_velocity — beforeSprintId (ADR-015)
// ========================================================================

describe("get_velocity beforeSprintId (v1.5 ADR-015)", () => {
  // closedSprintA: completeDate 2026-04-14 (before anchor 2026-06-15)
  // closedSprintB: completeDate 2026-05-14 (before anchor 2026-06-15)
  // closedSprintC: completeDate 2026-06-14 (before anchor 2026-06-15)
  // selectedSprint (55): startDate 2026-06-15 = anchor

  it("only includes closed sprints strictly before the selected sprint's startDate", async () => {
    client.getSprintsByState.mockResolvedValueOnce([
      closedSprintC, // 2026-06-14 — before anchor 2026-06-15 ✓
      closedSprintB, // 2026-05-14 — before anchor ✓
      closedSprintA, // 2026-04-14 — before anchor ✓
    ]);
    client.getSprintMeta.mockResolvedValueOnce(sprintMeta); // anchor for beforeSprintId=55

    // All three sprints qualify; take sprintCount=2 (latest-first from window)
    // Sorted latest-first in window: C(52), B(51), A(50) → take 2 → [C, B] → reverse chrono → [B, C]
    client.getSprintIssues
      .mockResolvedValueOnce([makeIssue({ statusCategory: "done", storyPoints: 6 })]) // C (id=52)
      .mockResolvedValueOnce([makeIssue({ statusCategory: "done", storyPoints: 4 })]) // B (id=51)

    const result = await getVelocityTool.handler({
      beforeSprintId: 55,
      sprintCount: 2,
    }) as {
      sprints: { id: number; completedPoints: number }[];
      averageCompleted: number;
    };

    expect(result.sprints).toHaveLength(2);
    // Chronological (oldest first after reverse): B (51) then C (52)
    expect(result.sprints[0]!.id).toBe(51);
    expect(result.sprints[1]!.id).toBe(52);
    // averageCompleted = (4 + 6) / 2 = 5
    expect(result.averageCompleted).toBeCloseTo(5);
  });

  it("excludes the beforeSprintId sprint itself from the window", async () => {
    // Closed sprints include the selected sprint's id (55) — should be excluded
    const closedSelected = {
      id: 55, // same as beforeSprintId
      name: "Sprint 8",
      state: "closed",
      startDate: "2026-06-15T00:00:00.000Z",
      endDate: "2026-06-28T00:00:00.000Z",
      completeDate: "2026-06-28T00:00:00.000Z",
      goal: null,
    };
    client.getSprintsByState.mockResolvedValueOnce([
      closedSelected, // excluded by id
      closedSprintB,  // included (before anchor)
    ]);
    client.getSprintMeta.mockResolvedValueOnce(sprintMeta); // anchor startDate 2026-06-15

    client.getSprintIssues.mockResolvedValueOnce([
      makeIssue({ statusCategory: "done", storyPoints: 4 }),
    ]);

    const result = await getVelocityTool.handler({
      beforeSprintId: 55,
      sprintCount: 6,
    }) as {
      sprints: { id: number }[];
    };

    const ids = result.sprints.map((s) => s.id);
    expect(ids).not.toContain(55); // excluded
    expect(ids).toContain(51);     // included
  });

  it("excludes closed sprints whose completeDate is NOT before the selected sprint's startDate", async () => {
    // closedSprintC has completeDate "2026-06-14" which IS before "2026-06-15" → included
    // A sprint completing after the anchor → excluded
    const afterAnchor = {
      id: 53,
      name: "Sprint 7b",
      state: "closed",
      startDate: "2026-06-14T00:00:00.000Z",
      endDate: "2026-06-28T00:00:00.000Z",
      completeDate: "2026-06-28T00:00:00.000Z", // after anchor 2026-06-15
      goal: null,
    };
    client.getSprintsByState.mockResolvedValueOnce([
      afterAnchor,  // completeDate 2026-06-28 >= anchor 2026-06-15 → excluded
      closedSprintC, // completeDate 2026-06-14 < anchor 2026-06-15 → included
    ]);
    client.getSprintMeta.mockResolvedValueOnce(sprintMeta);
    client.getSprintIssues.mockResolvedValueOnce([
      makeIssue({ statusCategory: "done", storyPoints: 6 }),
    ]);

    const result = await getVelocityTool.handler({
      beforeSprintId: 55,
      sprintCount: 6,
    }) as { sprints: { id: number }[] };

    const ids = result.sprints.map((s) => s.id);
    expect(ids).not.toContain(53); // after anchor, excluded
    expect(ids).toContain(52);     // before anchor, included
  });

  it("returns zeros when the window is empty (no sprints before the selected one)", async () => {
    client.getSprintsByState.mockResolvedValueOnce([
      // All sprints are at or after the anchor
      {
        id: 56,
        name: "Sprint 9",
        state: "closed",
        startDate: "2026-06-20T00:00:00.000Z",
        endDate: "2026-07-03T00:00:00.000Z",
        completeDate: "2026-07-03T00:00:00.000Z",
        goal: null,
      },
    ]);
    client.getSprintMeta.mockResolvedValueOnce(sprintMeta); // anchor 2026-06-15

    const result = await getVelocityTool.handler({
      beforeSprintId: 55,
      sprintCount: 6,
    }) as {
      sprints: unknown[];
      averageCompleted: number;
      forecastNext: number;
    };

    expect(result.sprints).toHaveLength(0);
    expect(result.averageCompleted).toBe(0);
    expect(result.forecastNext).toBe(0);
  });

  it("without beforeSprintId — falls back to latest-N closed (unchanged behavior)", async () => {
    client.getSprintsByState.mockResolvedValueOnce([closedSprintC, closedSprintB, closedSprintA]);
    // Take sprintCount=2 → C and B (latest two)
    client.getSprintIssues
      .mockResolvedValueOnce([makeIssue({ statusCategory: "done", storyPoints: 6 })])
      .mockResolvedValueOnce([makeIssue({ statusCategory: "done", storyPoints: 4 })]);

    const result = await getVelocityTool.handler({ sprintCount: 2 }) as {
      sprints: { id: number }[];
    };

    // No beforeSprintId → no getSprintMeta call
    expect(client.getSprintMeta).not.toHaveBeenCalled();
    // Latest two: C(52) and B(51) → chronological: B(51), C(52)
    expect(result.sprints.map((s) => s.id)).toEqual([51, 52]);
  });

  it("forecastNext has at most 2 decimal places", async () => {
    client.getSprintsByState.mockResolvedValueOnce([closedSprintA, closedSprintB, closedSprintC]);
    client.getSprintMeta.mockResolvedValueOnce(sprintMeta);
    // Completed: 10, 11, 12 → avg = 33/3 = 11 (even)
    client.getSprintIssues
      .mockResolvedValueOnce([makeIssue({ statusCategory: "done", storyPoints: 10 })])
      .mockResolvedValueOnce([makeIssue({ statusCategory: "done", storyPoints: 12 })])
      .mockResolvedValueOnce([makeIssue({ statusCategory: "done", storyPoints: 11 })]);

    const result = await getVelocityTool.handler({
      beforeSprintId: 55,
      sprintCount: 3,
    }) as { forecastNext: number };

    // Check that it's a number with ≤ 2 decimal places
    const str = String(result.forecastNext);
    const decimals = str.includes(".") ? str.split(".")[1]!.length : 0;
    expect(decimals).toBeLessThanOrEqual(2);
  });
});

// ========================================================================
// C. Leaves store + tools (ADR-016)
// ========================================================================

describe("leavesStore — readLeaves / writeLeaves", () => {
  it("returns {} when file does not exist", async () => {
    // JIRA_LEAVES_FILE set to temp path that does not exist
    const result = await getLeavesTool.handler({ sprintId: 99 }) as {
      sprintId: number;
      leaves: Record<string, string[]>;
    };
    expect(result.sprintId).toBe(99);
    expect(result.leaves).toEqual({});
  });

  it("returns {} when file contains corrupt JSON", async () => {
    const filePath = tempLeavesFile!;
    fs.writeFileSync(filePath, "not json {{{", "utf8");

    const result = await getLeavesTool.handler({ sprintId: 99 }) as {
      leaves: Record<string, string[]>;
    };
    expect(result.leaves).toEqual({});
  });

  it("returns {} when file contains a JSON array (not object)", async () => {
    const filePath = tempLeavesFile!;
    fs.writeFileSync(filePath, JSON.stringify([1, 2, 3]), "utf8");

    const result = await getLeavesTool.handler({ sprintId: 99 }) as {
      leaves: Record<string, string[]>;
    };
    expect(result.leaves).toEqual({});
  });
});

describe("set_leaves — validation", () => {
  it("rejects invalid date format (YYYY/MM/DD)", async () => {
    await expect(
      setLeavesTool.handler({ sprintId: 55, assignee: "Alice", dates: ["2026/06/03"] })
    ).rejects.toThrow();
  });

  it("rejects partial date (YYYY-MM)", async () => {
    await expect(
      setLeavesTool.handler({ sprintId: 55, assignee: "Alice", dates: ["2026-06"] })
    ).rejects.toThrow();
  });

  it("rejects non-date string", async () => {
    await expect(
      setLeavesTool.handler({ sprintId: 55, assignee: "Alice", dates: ["not-a-date"] })
    ).rejects.toThrow();
  });

  it("rejects empty assignee", async () => {
    await expect(
      setLeavesTool.handler({ sprintId: 55, assignee: "", dates: ["2026-06-03"] })
    ).rejects.toThrow();
  });

  it("rejects assignee longer than 120 characters", async () => {
    await expect(
      setLeavesTool.handler({ sprintId: 55, assignee: "x".repeat(121), dates: ["2026-06-03"] })
    ).rejects.toThrow();
  });

  it("accepts a valid date", async () => {
    const result = await setLeavesTool.handler({
      sprintId: 55,
      assignee: "Alice",
      dates: ["2026-06-03"],
    }) as { sprintId: number; leaves: Record<string, string[]> };

    expect(result.sprintId).toBe(55);
    expect(result.leaves["Alice"]).toEqual(["2026-06-03"]);
  });
});

describe("set_leaves → get_leaves round-trip", () => {
  it("set then get returns the same data", async () => {
    await setLeavesTool.handler({
      sprintId: 55,
      assignee: "Alice",
      dates: ["2026-06-03", "2026-06-04"],
    });

    const result = await getLeavesTool.handler({ sprintId: 55 }) as {
      sprintId: number;
      leaves: Record<string, string[]>;
    };

    expect(result.sprintId).toBe(55);
    expect(result.leaves["Alice"]).toEqual(["2026-06-03", "2026-06-04"]);
  });

  it("set for one sprint does not affect another sprint", async () => {
    await setLeavesTool.handler({ sprintId: 55, assignee: "Alice", dates: ["2026-06-03"] });
    await setLeavesTool.handler({ sprintId: 56, assignee: "Bob", dates: ["2026-06-10"] });

    const s55 = await getLeavesTool.handler({ sprintId: 55 }) as { leaves: Record<string, string[]> };
    const s56 = await getLeavesTool.handler({ sprintId: 56 }) as { leaves: Record<string, string[]> };

    expect(s55.leaves["Alice"]).toEqual(["2026-06-03"]);
    expect(s55.leaves["Bob"]).toBeUndefined();
    expect(s56.leaves["Bob"]).toEqual(["2026-06-10"]);
    expect(s56.leaves["Alice"]).toBeUndefined();
  });

  it("multiple assignees in the same sprint", async () => {
    await setLeavesTool.handler({ sprintId: 55, assignee: "Alice", dates: ["2026-06-03"] });
    await setLeavesTool.handler({ sprintId: 55, assignee: "Bob", dates: ["2026-06-04", "2026-06-05"] });

    const result = await getLeavesTool.handler({ sprintId: 55 }) as { leaves: Record<string, string[]> };

    expect(result.leaves["Alice"]).toEqual(["2026-06-03"]);
    expect(result.leaves["Bob"]).toEqual(["2026-06-04", "2026-06-05"]);
  });
});

describe("set_leaves — replace overwrites previous dates", () => {
  it("replaces all dates when called again for the same assignee+sprint", async () => {
    await setLeavesTool.handler({ sprintId: 55, assignee: "Alice", dates: ["2026-06-03", "2026-06-04"] });
    // Replace with a different date
    const result = await setLeavesTool.handler({
      sprintId: 55,
      assignee: "Alice",
      dates: ["2026-06-10"],
    }) as { leaves: Record<string, string[]> };

    expect(result.leaves["Alice"]).toEqual(["2026-06-10"]);
    expect(result.leaves["Alice"]).not.toContain("2026-06-03");
  });
});

describe("set_leaves — empty dates clears the assignee", () => {
  it("clearing an assignee removes their entry from the sprint map", async () => {
    await setLeavesTool.handler({ sprintId: 55, assignee: "Alice", dates: ["2026-06-03"] });
    const cleared = await setLeavesTool.handler({
      sprintId: 55,
      assignee: "Alice",
      dates: [],
    }) as { leaves: Record<string, string[]> };

    expect(cleared.leaves["Alice"]).toBeUndefined();
  });

  it("clearing the only assignee yields an empty leaves map", async () => {
    await setLeavesTool.handler({ sprintId: 55, assignee: "Alice", dates: ["2026-06-03"] });
    const cleared = await setLeavesTool.handler({ sprintId: 55, assignee: "Alice", dates: [] }) as {
      leaves: Record<string, string[]>;
    };

    expect(Object.keys(cleared.leaves)).toHaveLength(0);
  });

  it("get_leaves returns {} after the last assignee is cleared", async () => {
    await setLeavesTool.handler({ sprintId: 55, assignee: "Alice", dates: ["2026-06-03"] });
    await setLeavesTool.handler({ sprintId: 55, assignee: "Alice", dates: [] });

    const result = await getLeavesTool.handler({ sprintId: 55 }) as { leaves: Record<string, string[]> };
    expect(result.leaves).toEqual({});
  });
});

describe("set_leaves — deduplication and sorting", () => {
  it("dedupes dates", async () => {
    const result = await setLeavesTool.handler({
      sprintId: 55,
      assignee: "Alice",
      dates: ["2026-06-04", "2026-06-03", "2026-06-04"],
    }) as { leaves: Record<string, string[]> };

    expect(result.leaves["Alice"]).toEqual(["2026-06-03", "2026-06-04"]);
  });

  it("sorts dates in ascending order", async () => {
    const result = await setLeavesTool.handler({
      sprintId: 55,
      assignee: "Alice",
      dates: ["2026-06-10", "2026-06-03", "2026-06-07"],
    }) as { leaves: Record<string, string[]> };

    expect(result.leaves["Alice"]).toEqual(["2026-06-03", "2026-06-07", "2026-06-10"]);
  });
});

// ========================================================================
// C. get_leaves / set_leaves registered in tool registry
// ========================================================================

describe("leaves tools in tool registry", () => {
  it("get_leaves is registered in tools/index.ts", async () => {
    const { tools } = await import("../src/tools/index.js");
    const names = tools.map((t) => t.name);
    expect(names).toContain("get_leaves");
  });

  it("set_leaves is registered in tools/index.ts", async () => {
    const { tools } = await import("../src/tools/index.js");
    const names = tools.map((t) => t.name);
    expect(names).toContain("set_leaves");
  });
});
