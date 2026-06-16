/**
 * v1.4 feature tests — sprint management + Phase 3 reports + AI sprint summary.
 *
 * All tests run keyless and offline:
 * - jiraClient is vi.mocked (no network)
 * - @anthropic-ai/sdk is vi.mocked
 * - global fetch is stubbed for GitHub provider tests
 *
 * Covers:
 * A. Config: JIRA_VELOCITY_SPRINTS
 * B. Future sprint selection (sprintSelect + getSprint + getDailyHuddle)
 * C. Add-to-sprint (createPoTicket + createDevTicket)
 * D. New tools: create_sprint, list_sprints, get_sprint_report, get_velocity
 * E. AI sprint summary HTTP endpoint
 * F. Existing test shapes updated for futureSprints
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
  type MockedObject,
  type Mock,
} from "vitest";
import { resetConfigCache } from "../src/lib/config.js";
import {
  sortSprintsEarliestFirst,
  selectSprintFromActiveFuture,
} from "../src/lib/sprintSelect.js";
import type { SprintStub } from "../src/lib/sprintSelect.js";

// ---- Mock jiraClient before importing tools/app ----
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

// ---- Mock @anthropic-ai/sdk ----
vi.mock("@anthropic-ai/sdk", () => {
  const mockParse = vi.fn();

  class MockAuthenticationError extends Error {
    constructor() { super("Invalid API key"); this.name = "AuthenticationError"; }
  }
  class MockRateLimitError extends Error {
    constructor() { super("Rate limit exceeded"); this.name = "RateLimitError"; }
  }
  class MockAPIError extends Error {
    status: number;
    constructor(status: number, msg: string) {
      super(msg); this.name = "APIError"; this.status = status;
    }
  }

  const mockMessages = { parse: mockParse };
  const MockAnthropic = vi.fn().mockImplementation(() => ({
    messages: mockMessages,
  }));
  (MockAnthropic as unknown as Record<string, unknown>)["AuthenticationError"] = MockAuthenticationError;
  (MockAnthropic as unknown as Record<string, unknown>)["RateLimitError"] = MockRateLimitError;
  (MockAnthropic as unknown as Record<string, unknown>)["APIError"] = MockAPIError;

  return { default: MockAnthropic };
});

vi.mock("@anthropic-ai/sdk/helpers/zod", () => ({
  zodOutputFormat: vi.fn().mockReturnValue({ type: "json_schema" }),
}));

import * as jiraClient from "../src/lib/jiraClient.js";
import { createPoTicket } from "../src/tools/createPoTicket.js";
import { createDevTicket } from "../src/tools/createDevTicket.js";
import { getSprint } from "../src/tools/getSprint.js";
import { getDailyHuddle } from "../src/tools/getDailyHuddle.js";
import { createSprintTool } from "../src/tools/createSprint.js";
import { normalizeDateToISO } from "../src/tools/createSprint.js";
import { listSprintsTool } from "../src/tools/listSprints.js";
import { getSprintReportTool } from "../src/tools/getSprintReport.js";
import { getVelocityTool } from "../src/tools/getVelocity.js";
import type { IssueSummary } from "../src/lib/types.js";
import Anthropic from "@anthropic-ai/sdk";

const client = jiraClient as MockedObject<typeof jiraClient>;
const MockAnthropicClass = Anthropic as unknown as Mock;

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
}

const originalEnv = { ...process.env };

beforeEach(() => {
  resetConfigCache();
  setRequiredEnv();
  vi.clearAllMocks();
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
  resetConfigCache();
  vi.unstubAllGlobals();
});

// ---- Fixtures ----

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

const activeSprint = {
  id: 55,
  name: "Sprint 7",
  state: "active",
  startDate: "2026-06-01T00:00:00.000Z",
  endDate: "2026-06-14T00:00:00.000Z",
  completeDate: null,
  goal: "Ship it",
};

const futureSprint1 = {
  id: 56,
  name: "Sprint 8",
  state: "future",
  startDate: "2026-06-15T00:00:00.000Z",
  endDate: "2026-06-28T00:00:00.000Z",
  completeDate: null,
  goal: "Next things",
};

const futureSprint2 = {
  id: 57,
  name: "Sprint 9",
  state: "future",
  startDate: "2026-06-29T00:00:00.000Z",
  endDate: "2026-07-12T00:00:00.000Z",
  completeDate: null,
  goal: null,
};

// ========================================================================
// A. Config: JIRA_VELOCITY_SPRINTS
// ========================================================================

import { getConfig } from "../src/lib/config.js";

describe("Config: JIRA_VELOCITY_SPRINTS", () => {
  it("defaults to 6 when not set", () => {
    const cfg = getConfig();
    expect(cfg.JIRA_VELOCITY_SPRINTS).toBe(6);
  });

  it("coerces string to integer", () => {
    process.env["JIRA_VELOCITY_SPRINTS"] = "10";
    resetConfigCache();
    const cfg = getConfig();
    expect(cfg.JIRA_VELOCITY_SPRINTS).toBe(10);
  });

  it("server does not fail at startup when JIRA_VELOCITY_SPRINTS is absent", () => {
    delete process.env["JIRA_VELOCITY_SPRINTS"];
    resetConfigCache();
    expect(() => getConfig()).not.toThrow();
  });
});

// ========================================================================
// B. Future sprint sort (pure function)
// ========================================================================

describe("sortSprintsEarliestFirst", () => {
  function makeSprint(overrides: Partial<SprintStub>): SprintStub {
    return {
      id: 1,
      name: "Sprint 1",
      state: "future",
      startDate: "2026-06-01T00:00:00.000Z",
      endDate: "2026-06-14T00:00:00.000Z",
      goal: null,
      ...overrides,
    };
  }

  it("sorts earliest startDate first", () => {
    const sprints = [
      makeSprint({ id: 1, startDate: "2026-07-01T00:00:00.000Z" }),
      makeSprint({ id: 2, startDate: "2026-06-01T00:00:00.000Z" }),
      makeSprint({ id: 3, startDate: "2026-08-01T00:00:00.000Z" }),
    ];
    const sorted = sortSprintsEarliestFirst(sprints);
    expect(sorted.map((s) => s.id)).toEqual([2, 1, 3]);
  });

  it("null startDate sorts last", () => {
    const sprints = [
      makeSprint({ id: 1, startDate: null }),
      makeSprint({ id: 2, startDate: "2026-06-01T00:00:00.000Z" }),
      makeSprint({ id: 3, startDate: null }),
    ];
    const sorted = sortSprintsEarliestFirst(sprints);
    expect(sorted[0]!.id).toBe(2);
    // Both null sprints come after; ascending id tiebreak
    expect(sorted[1]!.id).toBe(1);
    expect(sorted[2]!.id).toBe(3);
  });

  it("ties broken by ascending id", () => {
    const sprints = [
      makeSprint({ id: 9, startDate: "2026-06-01T00:00:00.000Z" }),
      makeSprint({ id: 2, startDate: "2026-06-01T00:00:00.000Z" }),
      makeSprint({ id: 5, startDate: "2026-06-01T00:00:00.000Z" }),
    ];
    const sorted = sortSprintsEarliestFirst(sprints);
    expect(sorted.map((s) => s.id)).toEqual([2, 5, 9]);
  });

  it("returns new array, does not mutate input", () => {
    const sprints = [
      makeSprint({ id: 1, startDate: "2026-06-01T00:00:00.000Z" }),
      makeSprint({ id: 2, startDate: "2026-05-01T00:00:00.000Z" }),
    ];
    const copy = [...sprints];
    sortSprintsEarliestFirst(sprints);
    expect(sprints[0]!.id).toBe(copy[0]!.id);
  });
});

// ========================================================================
// B. selectSprintFromActiveFuture (pure function)
// ========================================================================

describe("selectSprintFromActiveFuture", () => {
  function makeSprint(overrides: Partial<SprintStub>): SprintStub {
    return {
      id: 1, name: "S1", state: "active",
      startDate: "2026-06-01T00:00:00.000Z",
      endDate: "2026-06-14T00:00:00.000Z", goal: null,
      ...overrides,
    };
  }

  const active = [makeSprint({ id: 55, state: "active" })];
  const future = [
    makeSprint({ id: 56, state: "future", startDate: "2026-06-15T00:00:00.000Z" }),
    makeSprint({ id: 57, state: "future", startDate: "2026-06-29T00:00:00.000Z" }),
  ];

  it("throws when both lists are empty", () => {
    expect(() => selectSprintFromActiveFuture([], [], 1000)).toThrow(
      "No active or future sprint found for board 1000"
    );
  });

  it("defaults to first active sprint when active list is non-empty", () => {
    const selected = selectSprintFromActiveFuture(active, future, 1000);
    expect(selected.id).toBe(55);
  });

  it("falls back to first future sprint when no active sprints", () => {
    const selected = selectSprintFromActiveFuture([], future, 1000);
    expect(selected.id).toBe(56); // earliest-first
  });

  it("selects future sprint by explicit sprintId", () => {
    const selected = selectSprintFromActiveFuture(active, future, 1000, 57);
    expect(selected.id).toBe(57);
  });

  it("selects active sprint by explicit sprintId", () => {
    const selected = selectSprintFromActiveFuture(active, future, 1000, 55);
    expect(selected.id).toBe(55);
  });

  it("throws correct error for sprintId not in active or future", () => {
    expect(() => selectSprintFromActiveFuture(active, future, 1000, 999)).toThrow(
      "Sprint 999 is not an active or future sprint on board 1000"
    );
  });

  it("throws correct error when only future exists and sprintId is wrong", () => {
    expect(() => selectSprintFromActiveFuture([], future, 42, 999)).toThrow(
      "Sprint 999 is not an active or future sprint on board 42"
    );
  });
});

// ========================================================================
// B. get_active_sprint — future sprints in output (v1.4)
// ========================================================================

describe("get_active_sprint v1.4 — future sprints", () => {
  it("returns futureSprints array (earliest-first) alongside activeSprints", async () => {
    client.getActiveAndFutureSprints.mockResolvedValueOnce([
      activeSprint,
      futureSprint2, // later
      futureSprint1, // earlier
    ]);
    client.getSprintIssues.mockResolvedValueOnce([]);

    const result = await getSprint.handler({}) as {
      activeSprints: { id: number }[];
      futureSprints: { id: number }[];
      sprint: { id: number; state: string };
    };

    expect(result.activeSprints).toHaveLength(1);
    expect(result.activeSprints[0]!.id).toBe(55);
    expect(result.futureSprints).toHaveLength(2);
    // Earliest-first: 56 before 57
    expect(result.futureSprints[0]!.id).toBe(56);
    expect(result.futureSprints[1]!.id).toBe(57);
    // Default: latest active selected
    expect(result.sprint.id).toBe(55);
    expect(result.sprint.state).toBe("active");
  });

  it("falls back to first future sprint when no active sprints", async () => {
    client.getActiveAndFutureSprints.mockResolvedValueOnce([
      futureSprint2,
      futureSprint1,
    ]);
    client.getSprintIssues.mockResolvedValueOnce([]);

    const result = await getSprint.handler({}) as {
      sprint: { id: number; state: string };
      activeSprints: unknown[];
      futureSprints: { id: number }[];
    };

    expect(result.activeSprints).toHaveLength(0);
    expect(result.sprint.id).toBe(56); // earliest future
    expect(result.sprint.state).toBe("future");
  });

  it("selects future sprint by explicit sprintId", async () => {
    client.getActiveAndFutureSprints.mockResolvedValueOnce([
      activeSprint,
      futureSprint1,
      futureSprint2,
    ]);
    client.getSprintIssues.mockResolvedValueOnce([]);

    const result = await getSprint.handler({ sprintId: 56 }) as {
      sprint: { id: number; state: string };
    };

    expect(result.sprint.id).toBe(56);
    expect(result.sprint.state).toBe("future");
    expect(client.getSprintIssues).toHaveBeenCalledWith(56, 50);
  });

  it("throws v1.4 error when sprintId not in active or future", async () => {
    client.getActiveAndFutureSprints.mockResolvedValueOnce([activeSprint]);

    await expect(getSprint.handler({ sprintId: 999 })).rejects.toThrow(
      "Sprint 999 is not an active or future sprint on board 10002"
    );
  });

  it("throws v1.4 error when no active or future sprints exist", async () => {
    client.getActiveAndFutureSprints.mockResolvedValueOnce([]);

    await expect(getSprint.handler({})).rejects.toThrow(
      "No active or future sprint found for board 10002"
    );
  });

  it("future sprint with no issues yields empty buckets (planning view)", async () => {
    client.getActiveAndFutureSprints.mockResolvedValueOnce([futureSprint1]);
    client.getSprintIssues.mockResolvedValueOnce([]);

    const result = await getSprint.handler({}) as {
      issuesByStatus: { todo: unknown[]; inprogress: unknown[]; codereview: unknown[]; done: unknown[] };
      totals: { total: number };
    };

    expect(result.issuesByStatus.todo).toHaveLength(0);
    expect(result.issuesByStatus.inprogress).toHaveLength(0);
    expect(result.issuesByStatus.codereview).toHaveLength(0);
    expect(result.issuesByStatus.done).toHaveLength(0);
    expect(result.totals.total).toBe(0);
  });
});

// ========================================================================
// B. get_daily_huddle — uses active+future selection (v1.4)
// ========================================================================

describe("get_daily_huddle v1.4 — future sprint selection", () => {
  it("falls back to future sprint when no active sprint", async () => {
    client.getActiveAndFutureSprints.mockResolvedValueOnce([futureSprint1]);
    client.getSprintIssues.mockResolvedValueOnce([]);

    const result = await getDailyHuddle.handler({}) as { sprintId: number };
    expect(result.sprintId).toBe(56);
  });

  it("throws v1.4 error when no active or future sprint", async () => {
    client.getActiveAndFutureSprints.mockResolvedValueOnce([]);
    await expect(getDailyHuddle.handler({})).rejects.toThrow(
      "No active or future sprint found for board 10002"
    );
  });

  it("throws v1.4 error for invalid sprintId", async () => {
    client.getActiveAndFutureSprints.mockResolvedValueOnce([activeSprint]);
    await expect(getDailyHuddle.handler({ sprintId: 999 })).rejects.toThrow(
      "Sprint 999 is not an active or future sprint on board 10002"
    );
  });
});

// ========================================================================
// C. Add-to-sprint: create_po_ticket
// ========================================================================

describe("create_po_ticket v1.4 — add-to-sprint", () => {
  it("attaches sprintId on success", async () => {
    client.createIssue.mockResolvedValueOnce("PO-42");
    client.addIssuesToSprint.mockResolvedValueOnce(undefined);

    const result = await createPoTicket.handler({
      summary: "New feature",
      description: "Desc",
      sprintId: 55,
    }) as { key: string; sprintId?: number; sprintWarning?: string };

    expect(result.key).toBe("PO-42");
    expect(result.sprintId).toBe(55);
    expect(result.sprintWarning).toBeUndefined();
    expect(client.addIssuesToSprint).toHaveBeenCalledWith(55, ["PO-42"]);
  });

  it("attaches sprintWarning and still returns ticket when sprint add fails", async () => {
    client.createIssue.mockResolvedValueOnce("PO-42");
    client.addIssuesToSprint.mockRejectedValueOnce(new Error("Project not on board"));

    const result = await createPoTicket.handler({
      summary: "New feature",
      description: "Desc",
      sprintId: 55,
    }) as { key: string; sprintId?: number; sprintWarning?: string };

    expect(result.key).toBe("PO-42");
    expect(result.sprintId).toBeUndefined();
    expect(result.sprintWarning).toContain("Project not on board");
  });

  it("does not call addIssuesToSprint when sprintId not provided", async () => {
    client.createIssue.mockResolvedValueOnce("PO-10");

    await createPoTicket.handler({ summary: "s", description: "d" });
    expect(client.addIssuesToSprint).not.toHaveBeenCalled();
  });
});

// ========================================================================
// C. Add-to-sprint: create_dev_ticket
// ========================================================================

describe("create_dev_ticket v1.4 — add-to-sprint", () => {
  it("attaches sprintId on success (no link)", async () => {
    client.createIssue.mockResolvedValueOnce("DEV-99");
    client.addIssuesToSprint.mockResolvedValueOnce(undefined);

    const result = await createDevTicket.handler({
      summary: "Dev task",
      description: "Impl",
      sprintId: 56,
    }) as { key: string; sprintId?: number; sprintWarning?: string };

    expect(result.key).toBe("DEV-99");
    expect(result.sprintId).toBe(56);
    expect(result.sprintWarning).toBeUndefined();
  });

  it("attaches sprintWarning and still returns ticket when sprint add fails", async () => {
    client.createIssue.mockResolvedValueOnce("DEV-99");
    client.addIssuesToSprint.mockRejectedValueOnce(new Error("Sprint not found"));

    const result = await createDevTicket.handler({
      summary: "Dev task",
      description: "Impl",
      sprintId: 56,
    }) as { key: string; sprintId?: number; sprintWarning?: string };

    expect(result.key).toBe("DEV-99");
    expect(result.sprintId).toBeUndefined();
    expect(result.sprintWarning).toContain("Sprint not found");
  });

  it("links THEN adds to sprint (correct order)", async () => {
    const callOrder: string[] = [];
    client.createIssue.mockResolvedValueOnce("DEV-99");
    client.createIssueLink.mockImplementationOnce(async () => { callOrder.push("link"); });
    client.addIssuesToSprint.mockImplementationOnce(async () => { callOrder.push("sprint"); });

    await createDevTicket.handler({
      summary: "Dev task",
      description: "Impl",
      linkedPoTicketKey: "PO-42",
      sprintId: 56,
    });

    expect(callOrder).toEqual(["link", "sprint"]);
  });

  it("sprint step happens even if link step fails", async () => {
    client.createIssue.mockResolvedValueOnce("DEV-99");
    client.createIssueLink.mockRejectedValueOnce(new Error("Link failed"));
    client.addIssuesToSprint.mockResolvedValueOnce(undefined);

    const result = await createDevTicket.handler({
      summary: "Dev task",
      description: "Impl",
      linkedPoTicketKey: "PO-42",
      sprintId: 56,
    }) as { key: string; linkWarning?: string; sprintId?: number };

    expect(result.key).toBe("DEV-99");
    expect(result.linkWarning).toContain("Link failed");
    expect(result.sprintId).toBe(56);
  });
});

// ========================================================================
// D. create_sprint
// ========================================================================

describe("create_sprint", () => {
  const mockCreated = {
    id: 100,
    name: "Sprint 10",
    state: "future",
    startDate: "2026-07-01T00:00:00.000Z",
    endDate: "2026-07-14T00:00:00.000Z",
    completeDate: null,
    goal: "New goal",
    boardId: 10002,
  };

  it("happy path: creates sprint and returns SprintRef with state future", async () => {
    client.createSprint.mockResolvedValueOnce(mockCreated);

    const result = await createSprintTool.handler({
      name: "Sprint 10",
      goal: "New goal",
      startDate: "2026-07-01T00:00:00.000Z",
      endDate: "2026-07-14T00:00:00.000Z",
    }) as { id: number; state: string; name: string };

    expect(result.id).toBe(100);
    expect(result.state).toBe("future");
    expect(result.name).toBe("Sprint 10");
    expect(client.createSprint).toHaveBeenCalledOnce();
  });

  it("normalizes date-only YYYY-MM-DD to T00:00:00.000Z", async () => {
    client.createSprint.mockResolvedValueOnce(mockCreated);

    await createSprintTool.handler({
      name: "Sprint 10",
      startDate: "2026-07-01",
      endDate: "2026-07-14",
    });

    const callArgs = client.createSprint.mock.calls[0]?.[0] as {
      startDate: string;
      endDate: string;
    };
    expect(callArgs.startDate).toBe("2026-07-01T00:00:00.000Z");
    expect(callArgs.endDate).toBe("2026-07-14T00:00:00.000Z");
  });

  it("normalizeDateToISO: leaves full ISO timestamps unchanged", () => {
    const ts = "2026-07-01T09:00:00.000Z";
    expect(normalizeDateToISO(ts)).toBe(ts);
  });

  it("normalizeDateToISO: appends T00:00:00.000Z for date-only", () => {
    expect(normalizeDateToISO("2026-07-01")).toBe("2026-07-01T00:00:00.000Z");
  });

  it("rejects when startDate >= endDate (same day)", async () => {
    await expect(
      createSprintTool.handler({
        name: "Sprint 10",
        startDate: "2026-07-01",
        endDate: "2026-07-01",
      })
    ).rejects.toThrow("startDate must be before endDate");
  });

  it("rejects when startDate > endDate", async () => {
    await expect(
      createSprintTool.handler({
        name: "Sprint 10",
        startDate: "2026-07-15",
        endDate: "2026-07-01",
      })
    ).rejects.toThrow("startDate must be before endDate");
  });

  it("rejects when name is empty", async () => {
    await expect(
      createSprintTool.handler({ name: "" })
    ).rejects.toThrow();
  });

  it("uses JIRA_DEV_BOARD_ID as default boardId", async () => {
    client.createSprint.mockResolvedValueOnce(mockCreated);

    await createSprintTool.handler({ name: "Sprint 10" });

    const callArgs = client.createSprint.mock.calls[0]?.[0] as { originBoardId: number };
    expect(callArgs.originBoardId).toBe(10002);
  });

  it("uses explicit boardId when provided", async () => {
    client.createSprint.mockResolvedValueOnce({ ...mockCreated, boardId: 99 });

    await createSprintTool.handler({ name: "Sprint 10", boardId: 99 });

    const callArgs = client.createSprint.mock.calls[0]?.[0] as { originBoardId: number };
    expect(callArgs.originBoardId).toBe(99);
  });
});

// ========================================================================
// D. list_sprints
// ========================================================================

const closedSprintA = {
  id: 50, name: "Sprint 5", state: "closed",
  startDate: "2026-04-01T00:00:00.000Z",
  endDate: "2026-04-14T00:00:00.000Z",
  completeDate: "2026-04-14T00:00:00.000Z",
  goal: null,
};
const closedSprintB = {
  id: 51, name: "Sprint 6", state: "closed",
  startDate: "2026-05-01T00:00:00.000Z",
  endDate: "2026-05-14T00:00:00.000Z",
  completeDate: "2026-05-14T00:00:00.000Z",
  goal: null,
};

describe("list_sprints", () => {
  it("returns all three groups sorted correctly", async () => {
    client.getSprintsByState.mockResolvedValueOnce([
      activeSprint,
      futureSprint2,
      futureSprint1,
      closedSprintA,
      closedSprintB,
    ]);

    const result = await listSprintsTool.handler({ state: "all" }) as {
      active: { id: number }[];
      future: { id: number }[];
      closed: { id: number }[];
      boardId: number;
    };

    expect(result.active).toHaveLength(1);
    expect(result.active[0]!.id).toBe(55);

    // Future: earliest-first (56 before 57)
    expect(result.future).toHaveLength(2);
    expect(result.future[0]!.id).toBe(56);
    expect(result.future[1]!.id).toBe(57);

    // Closed: latest-completed-first (51 before 50)
    expect(result.closed).toHaveLength(2);
    expect(result.closed[0]!.id).toBe(51);
    expect(result.closed[1]!.id).toBe(50);

    expect(result.boardId).toBe(10002);
  });

  it("requests active,future,closed when state=all", async () => {
    client.getSprintsByState.mockResolvedValueOnce([]);
    await listSprintsTool.handler({ state: "all" });
    expect(client.getSprintsByState).toHaveBeenCalledWith(10002, "active,future,closed");
  });

  it("requests only 'closed' when state=closed", async () => {
    client.getSprintsByState.mockResolvedValueOnce([closedSprintA]);
    const result = await listSprintsTool.handler({ state: "closed" }) as {
      active: unknown[]; future: unknown[]; closed: { id: number }[];
    };
    expect(result.active).toHaveLength(0);
    expect(result.future).toHaveLength(0);
    expect(result.closed).toHaveLength(1);
    expect(client.getSprintsByState).toHaveBeenCalledWith(10002, "closed");
  });

  it("maps completeDate correctly", async () => {
    client.getSprintsByState.mockResolvedValueOnce([closedSprintB]);
    const result = await listSprintsTool.handler({ state: "closed" }) as {
      closed: { id: number; completeDate: string | null }[];
    };
    expect(result.closed[0]!.completeDate).toBe("2026-05-14T00:00:00.000Z");
  });

  it("includes boardId on each SprintRef", async () => {
    client.getSprintsByState.mockResolvedValueOnce([activeSprint]);
    const result = await listSprintsTool.handler({ state: "active" }) as {
      active: { boardId: number }[];
    };
    expect(result.active[0]!.boardId).toBe(10002);
  });
});

// ========================================================================
// D. get_sprint_report
// ========================================================================

const sprintMeta = {
  id: 55, name: "Sprint 7", state: "active",
  startDate: "2026-06-01T00:00:00.000Z",
  endDate: "2026-06-14T00:00:00.000Z",
  completeDate: null, goal: "Ship it", boardId: 10002,
};

describe("get_sprint_report", () => {
  it("classifies completed vs notCompleted correctly", async () => {
    client.getSprintMeta.mockResolvedValueOnce(sprintMeta);
    client.getSprintIssues.mockResolvedValueOnce([
      makeIssue({ key: "DEV-1", statusCategory: "done", storyPoints: 5 }),
      makeIssue({ key: "DEV-2", statusCategory: "inprogress", storyPoints: 3 }),
      makeIssue({ key: "DEV-3", statusCategory: "todo", storyPoints: null }),
    ]);

    const result = await getSprintReportTool.handler({ sprintId: 55 }) as {
      completed: { key: string }[];
      notCompleted: { key: string }[];
      committedPoints: number;
      completedPoints: number;
      completionRate: number;
      totalCount: number;
      completedCount: number;
      carryoverCount: number;
    };

    expect(result.completed.map((i) => i.key)).toEqual(["DEV-1"]);
    expect(result.notCompleted.map((i) => i.key)).toContain("DEV-2");
    expect(result.notCompleted.map((i) => i.key)).toContain("DEV-3");
    expect(result.committedPoints).toBe(8); // 5 + 3 + 0
    expect(result.completedPoints).toBe(5);
    expect(result.completionRate).toBeCloseTo(5 / 8);
    expect(result.totalCount).toBe(3);
    expect(result.completedCount).toBe(1);
    expect(result.carryoverCount).toBe(2);
  });

  it("completionRate is 0 when committedPoints is 0", async () => {
    client.getSprintMeta.mockResolvedValueOnce(sprintMeta);
    client.getSprintIssues.mockResolvedValueOnce([
      makeIssue({ key: "DEV-1", statusCategory: "todo", storyPoints: null }),
    ]);

    const result = await getSprintReportTool.handler({ sprintId: 55 }) as {
      committedPoints: number; completionRate: number;
    };

    expect(result.committedPoints).toBe(0);
    expect(result.completionRate).toBe(0);
  });

  it("byAssignee aggregates correctly with Unassigned for null", async () => {
    client.getSprintMeta.mockResolvedValueOnce(sprintMeta);
    client.getSprintIssues.mockResolvedValueOnce([
      makeIssue({ key: "DEV-1", statusCategory: "done", assignee: "Alice", storyPoints: 5 }),
      makeIssue({ key: "DEV-2", statusCategory: "inprogress", assignee: "Alice", storyPoints: 3 }),
      makeIssue({ key: "DEV-3", statusCategory: "todo", assignee: null, storyPoints: 2 }),
    ]);

    const result = await getSprintReportTool.handler({ sprintId: 55 }) as {
      byAssignee: Array<{
        name: string; donePoints: number; totalPoints: number;
        doneCount: number; totalCount: number;
      }>;
    };

    const alice = result.byAssignee.find((a) => a.name === "Alice");
    const unassigned = result.byAssignee.find((a) => a.name === "Unassigned");

    expect(alice).toBeDefined();
    expect(alice!.totalPoints).toBe(8);
    expect(alice!.donePoints).toBe(5);
    expect(alice!.totalCount).toBe(2);
    expect(alice!.doneCount).toBe(1);

    expect(unassigned).toBeDefined();
    expect(unassigned!.totalPoints).toBe(2);
    expect(unassigned!.donePoints).toBe(0);
  });

  it("byAssignee sorted by totalPoints desc", async () => {
    client.getSprintMeta.mockResolvedValueOnce(sprintMeta);
    client.getSprintIssues.mockResolvedValueOnce([
      makeIssue({ key: "DEV-1", assignee: "Bob", storyPoints: 2, statusCategory: "todo" }),
      makeIssue({ key: "DEV-2", assignee: "Alice", storyPoints: 8, statusCategory: "done" }),
      makeIssue({ key: "DEV-3", assignee: "Carol", storyPoints: 5, statusCategory: "inprogress" }),
    ]);

    const result = await getSprintReportTool.handler({ sprintId: 55 }) as {
      byAssignee: { name: string; totalPoints: number }[];
    };

    expect(result.byAssignee[0]!.name).toBe("Alice");
    expect(result.byAssignee[1]!.name).toBe("Carol");
    expect(result.byAssignee[2]!.name).toBe("Bob");
  });

  it("blockedCount counts blocked issues across all buckets", async () => {
    client.getSprintMeta.mockResolvedValueOnce(sprintMeta);
    client.getSprintIssues.mockResolvedValueOnce([
      makeIssue({ key: "DEV-1", statusCategory: "done", blocked: true }),
      makeIssue({ key: "DEV-2", statusCategory: "inprogress", blocked: true }),
      makeIssue({ key: "DEV-3", statusCategory: "todo", blocked: false }),
    ]);

    const result = await getSprintReportTool.handler({ sprintId: 55 }) as { blockedCount: number };
    expect(result.blockedCount).toBe(2);
  });

  it("sprint field maps SprintRef correctly", async () => {
    client.getSprintMeta.mockResolvedValueOnce(sprintMeta);
    client.getSprintIssues.mockResolvedValueOnce([]);

    const result = await getSprintReportTool.handler({ sprintId: 55 }) as {
      sprint: {
        id: number; name: string; state: string;
        startDate: string | null; goal: string | null; boardId: number;
      };
    };

    expect(result.sprint.id).toBe(55);
    expect(result.sprint.name).toBe("Sprint 7");
    expect(result.sprint.state).toBe("active");
    expect(result.sprint.boardId).toBe(10002);
    expect(result.sprint.goal).toBe("Ship it");
  });
});

// ========================================================================
// D. get_velocity
// ========================================================================

describe("get_velocity", () => {
  it("happy path: averages over N closed sprints, returns chronological", async () => {
    client.getSprintsByState.mockResolvedValueOnce([
      { ...closedSprintB, id: 51, completeDate: "2026-05-14T00:00:00.000Z" }, // more recent
      { ...closedSprintA, id: 50, completeDate: "2026-04-14T00:00:00.000Z" }, // older
    ]);
    // Sprint 51 issues (more recent → latest-first → fetched first, reversed to oldest-first)
    client.getSprintIssues
      .mockResolvedValueOnce([ // sprint 51 (index 0 after latest-first sort)
        makeIssue({ statusCategory: "done", storyPoints: 5 }),
        makeIssue({ statusCategory: "todo", storyPoints: 3, key: "DEV-2" }),
      ])
      .mockResolvedValueOnce([ // sprint 50
        makeIssue({ statusCategory: "done", storyPoints: 8 }),
      ]);

    const result = await getVelocityTool.handler({ sprintCount: 2 }) as {
      boardId: number;
      sprintCount: number;
      sprints: { id: number; committedPoints: number; completedPoints: number }[];
      averageCompleted: number;
      forecastNext: number;
    };

    expect(result.boardId).toBe(10002);
    expect(result.sprintCount).toBe(2);
    expect(result.sprints).toHaveLength(2);

    // Chronological: oldest (50) first
    expect(result.sprints[0]!.id).toBe(50);
    expect(result.sprints[0]!.committedPoints).toBe(8);
    expect(result.sprints[0]!.completedPoints).toBe(8);
    expect(result.sprints[1]!.id).toBe(51);
    expect(result.sprints[1]!.committedPoints).toBe(8);
    expect(result.sprints[1]!.completedPoints).toBe(5);

    // Average: (8 + 5) / 2 = 6.5
    expect(result.averageCompleted).toBeCloseTo(6.5);
    expect(result.forecastNext).toBe(6.5); // rounds to 1 decimal
  });

  it("returns zeros when no closed sprints", async () => {
    client.getSprintsByState.mockResolvedValueOnce([]);

    const result = await getVelocityTool.handler({}) as {
      sprints: unknown[]; averageCompleted: number; forecastNext: number;
    };

    expect(result.sprints).toHaveLength(0);
    expect(result.averageCompleted).toBe(0);
    expect(result.forecastNext).toBe(0);
  });

  it("respects JIRA_VELOCITY_SPRINTS from config", async () => {
    process.env["JIRA_VELOCITY_SPRINTS"] = "3";
    resetConfigCache();

    // Return 5 sprints, but should only take first 3 (latest-completed)
    const fiveSprints = Array.from({ length: 5 }, (_, i) => ({
      id: 100 + i,
      name: `Sprint ${100 + i}`,
      state: "closed",
      startDate: `2026-0${i + 1}-01T00:00:00.000Z`,
      endDate: `2026-0${i + 1}-14T00:00:00.000Z`,
      completeDate: `2026-0${i + 1}-14T00:00:00.000Z`,
      goal: null,
    }));
    client.getSprintsByState.mockResolvedValueOnce(fiveSprints);

    // 3 issue-fetch calls for the 3 most recent sprints
    for (let i = 0; i < 3; i++) {
      client.getSprintIssues.mockResolvedValueOnce([
        makeIssue({ statusCategory: "done", storyPoints: 5 }),
      ]);
    }

    const result = await getVelocityTool.handler({}) as {
      sprintCount: number;
      sprints: unknown[];
    };

    expect(result.sprintCount).toBe(3);
    expect(result.sprints).toHaveLength(3);
    expect(client.getSprintIssues).toHaveBeenCalledTimes(3);
  });

  it("uses explicit sprintCount parameter over config default", async () => {
    client.getSprintsByState.mockResolvedValueOnce([closedSprintA]);
    client.getSprintIssues.mockResolvedValueOnce([]);

    const result = await getVelocityTool.handler({ sprintCount: 1 }) as {
      sprintCount: number;
    };

    expect(result.sprintCount).toBe(1);
  });

  it("completeDate is included per sprint", async () => {
    client.getSprintsByState.mockResolvedValueOnce([closedSprintB]);
    client.getSprintIssues.mockResolvedValueOnce([]);

    const result = await getVelocityTool.handler({ sprintCount: 1 }) as {
      sprints: { completeDate: string | null }[];
    };

    expect(result.sprints[0]!.completeDate).toBe("2026-05-14T00:00:00.000Z");
  });
});

// ========================================================================
// E. AI sprint summary HTTP endpoint
// ========================================================================

// Set env before importing http app
process.env["JIRA_BASE_URL"] = "https://test.atlassian.net";
process.env["JIRA_EMAIL"] = "test@example.com";
process.env["JIRA_API_TOKEN"] = "test-token";
process.env["JIRA_PO_BOARD_ID"] = "10001";
process.env["JIRA_DEV_BOARD_ID"] = "10002";
process.env["VITEST"] = "true";

resetConfigCache();

import { app } from "../src/http.js";
import type { Server } from "http";

let server: Server;
let baseUrl: string;

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        const port = addr !== null && typeof addr === "object" ? addr.port : 0;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    })
);

afterAll(
  () =>
    new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    })
);

async function post(path: string, body: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validSummaryBody = {
  sprintName: "Sprint 7",
  state: "closed",
  startDate: "2026-06-01",
  endDate: "2026-06-14",
  goal: "Ship it",
  committedPoints: 20,
  completedPoints: 16,
  completedCount: 8,
  totalCount: 10,
  carryoverCount: 2,
  blockedCount: 1,
  byAssignee: [
    { name: "Alice", donePoints: 10, totalPoints: 12, doneCount: 5, totalCount: 6 },
    { name: "Bob", donePoints: 6, totalPoints: 8, doneCount: 3, totalCount: 4 },
  ],
};

describe("POST /api/ai/sprint-summary — 503 AI_UNAVAILABLE", () => {
  it("returns 503 when AI_PROVIDER is not set", async () => {
    delete process.env["AI_PROVIDER"];
    resetConfigCache();

    const res = await post("/api/ai/sprint-summary", validSummaryBody);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("AI_UNAVAILABLE");
  });

  it("returns 503 when AI_PROVIDER is empty string", async () => {
    process.env["AI_PROVIDER"] = "";
    resetConfigCache();

    const res = await post("/api/ai/sprint-summary", validSummaryBody);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("AI_UNAVAILABLE");
  });
});

describe("POST /api/ai/sprint-summary — 500 CONFIG", () => {
  it("returns 500 CONFIG when AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is missing", async () => {
    process.env["AI_PROVIDER"] = "anthropic";
    delete process.env["ANTHROPIC_API_KEY"];
    resetConfigCache();

    const res = await post("/api/ai/sprint-summary", validSummaryBody);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("CONFIG");
    expect(body.error.message).toContain("ANTHROPIC_API_KEY");
  });
});

describe("POST /api/ai/sprint-summary — 400 VALIDATION", () => {
  it("returns 400 when sprintName is missing", async () => {
    process.env["AI_PROVIDER"] = "anthropic";
    process.env["ANTHROPIC_API_KEY"] = "test-key";
    resetConfigCache();

    const { sprintName: _omit, ...bodyWithoutName } = validSummaryBody;
    const res = await post("/api/ai/sprint-summary", bodyWithoutName);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION");
  });

  it("returns 400 when required numeric fields are missing", async () => {
    const res = await post("/api/ai/sprint-summary", {
      sprintName: "Sprint 7", state: "closed",
      // missing committedPoints etc.
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION");
  });
});

describe("POST /api/ai/sprint-summary — Anthropic happy path", () => {
  it("returns 200 with summary, provider, and model", async () => {
    process.env["AI_PROVIDER"] = "anthropic";
    process.env["ANTHROPIC_API_KEY"] = "test-key";
    process.env["ANTHROPIC_MODEL"] = "claude-opus-4-8";
    resetConfigCache();

    MockAnthropicClass.mockImplementation(() => ({
      messages: {
        parse: vi.fn().mockResolvedValue({
          parsed_output: { summary: "Sprint 7 delivered 80% of committed work." },
        }),
      },
    }));

    const res = await post("/api/ai/sprint-summary", validSummaryBody);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: { summary: string; provider: string; model: string };
    };
    expect(body.ok).toBe(true);
    expect(body.data.summary).toBe("Sprint 7 delivered 80% of committed work.");
    expect(body.data.provider).toBe("anthropic");
    expect(body.data.model).toBe("claude-opus-4-8");
  });
});

describe("POST /api/ai/sprint-summary — GitHub happy path", () => {
  const realFetch: typeof globalThis.fetch = globalThis.fetch.bind(globalThis);

  it("returns 200 with summary from GitHub provider", async () => {
    process.env["AI_PROVIDER"] = "github";
    process.env["GITHUB_TOKEN"] = "gh-test-token";
    process.env["GITHUB_MODELS_BASE_URL"] = "https://models.github.ai/inference";
    process.env["GITHUB_MODELS_MODEL"] = "openai/gpt-4o-mini";
    resetConfigCache();

    const ghResponse = JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              summary: "Sprint 7 was a success with 80% completion.",
            }),
          },
        },
      ],
    });

    const fetchMock = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : (url as Request).url;
      if (urlStr.startsWith("http://127.0.0.1")) {
        return realFetch(url, init);
      }
      return Promise.resolve(
        new Response(ghResponse, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await post("/api/ai/sprint-summary", validSummaryBody);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: { summary: string; provider: string };
    };
    expect(body.ok).toBe(true);
    expect(body.data.summary).toContain("Sprint 7");
    expect(body.data.provider).toBe("github");
  });
});

describe("POST /api/ai/sprint-summary — NOT in tool registry", () => {
  it("GET /api/tools does not include sprint-summary", async () => {
    const res = await fetch(`${baseUrl}/api/tools`);
    const body = (await res.json()) as { data: { name: string }[] };
    const names = body.data.map((t) => t.name);
    expect(names).not.toContain("sprint-summary");
    expect(names).not.toContain("ai/sprint-summary");
    // But new MCP tools ARE in the registry
    expect(names).toContain("create_sprint");
    expect(names).toContain("list_sprints");
    expect(names).toContain("get_sprint_report");
    expect(names).toContain("get_velocity");
  });
});
