/**
 * Tool handler tests — vi.mock the jiraClient module so no network calls occur.
 * process.env is set to valid values in beforeEach; resetConfigCache() is called
 * so getConfig() picks up the test env.
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
import { resetConfigCache } from "../src/lib/config.js";
import { UpstreamError } from "../src/lib/errors.js";

// ---- Mock jiraClient before importing tools ----
vi.mock("../src/lib/jiraClient.js", () => ({
  createIssue: vi.fn(),
  createIssueLink: vi.fn(),
  addIssuesToSprint: vi.fn(),
  getActiveSprints: vi.fn(),
  getActiveAndFutureSprints: vi.fn(),
  getSprintIssues: vi.fn(),
  getSprintsByState: vi.fn(),
  getSprintMeta: vi.fn(),
  createSprint: vi.fn(),
  getIssue: vi.fn(),
  updateIssue: vi.fn(),
  getIssueNumericId: vi.fn(),
  getDevStatusPullRequestsRaw: vi.fn(),
  isBlocked: vi.fn(),
  mapIssue: vi.fn(),
  resetClientCache: vi.fn(),
}));

import * as jiraClient from "../src/lib/jiraClient.js";
import { createPoTicket } from "../src/tools/createPoTicket.js";
import { createDevTicket } from "../src/tools/createDevTicket.js";
import { getSprint } from "../src/tools/getSprint.js";
import { getTicket } from "../src/tools/getTicket.js";
import { updateTicket } from "../src/tools/updateTicket.js";
import { getDailyHuddle } from "../src/tools/getDailyHuddle.js";
import {
  getIssuePullRequestsTool,
  parseDevStatusPullRequests,
} from "../src/tools/getIssuePullRequests.js";
import type { IssueSummary } from "../src/lib/types.js";

const client = jiraClient as MockedObject<typeof jiraClient>;

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
});

// ---- Sample sprint/issue fixtures ----

function makeIssue(
  overrides: Partial<IssueSummary> = {}
): IssueSummary {
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
  goal: "Ship it",
};

const olderSprint = {
  id: 44,
  name: "Sprint 6",
  state: "active",
  startDate: "2026-05-01T00:00:00.000Z",
  endDate: "2026-05-14T00:00:00.000Z",
  goal: null,
};

// ==================================================================
// create_po_ticket
// ==================================================================
describe("create_po_ticket", () => {
  it("happy path: returns TicketRef with board PO", async () => {
    client.createIssue.mockResolvedValueOnce("PO-42");

    const result = await createPoTicket.handler({
      summary: "New feature",
      description: "Description here",
      storyPoints: 5,
    });

    expect(result).toEqual({
      key: "PO-42",
      url: "https://test.atlassian.net/browse/PO-42",
      board: "PO",
    });
    expect(client.createIssue).toHaveBeenCalledOnce();
    const callArgs = client.createIssue.mock.calls[0]?.[0];
    expect(callArgs?.projectKey).toBe("PO");
    expect(callArgs?.issueType).toBe("Story");
    expect(callArgs?.storyPoints).toBe(5);
  });

  it("rejects input with summary > 255 chars", async () => {
    await expect(
      createPoTicket.handler({ summary: "x".repeat(256), description: "d" })
    ).rejects.toThrow();
  });

  it("rejects input with empty summary", async () => {
    await expect(
      createPoTicket.handler({ summary: "", description: "d" })
    ).rejects.toThrow();
  });

  it("maps 401 upstream error", async () => {
    client.createIssue.mockRejectedValueOnce(
      new UpstreamError(
        "Jira authentication failed — check JIRA_EMAIL / JIRA_API_TOKEN",
        401
      )
    );
    await expect(
      createPoTicket.handler({ summary: "s", description: "d" })
    ).rejects.toThrow("Jira authentication failed");
  });
});

// ==================================================================
// create_dev_ticket
// ==================================================================
describe("create_dev_ticket", () => {
  it("happy path: creates task without linking", async () => {
    client.createIssue.mockResolvedValueOnce("DEV-99");

    const result = await createDevTicket.handler({
      summary: "Dev task",
      description: "Impl details",
    });

    expect(result).toMatchObject({ key: "DEV-99", board: "DEV" });
    expect(client.createIssueLink).not.toHaveBeenCalled();
  });

  it("links to PO ticket when linkedPoTicketKey is provided", async () => {
    client.createIssue.mockResolvedValueOnce("DEV-99");
    client.createIssueLink.mockResolvedValueOnce(undefined);

    const result = await createDevTicket.handler({
      summary: "Dev task",
      description: "Impl",
      linkedPoTicketKey: "PO-42",
    }) as { linkedTo?: string; linkWarning?: string };

    expect(result.linkedTo).toBe("PO-42");
    expect(result.linkWarning).toBeUndefined();
  });

  it("returns linkWarning when link fails, but still creates ticket", async () => {
    client.createIssue.mockResolvedValueOnce("DEV-99");
    client.createIssueLink.mockRejectedValueOnce(new Error("Link type not found"));

    const result = await createDevTicket.handler({
      summary: "Dev task",
      description: "Impl",
      linkedPoTicketKey: "PO-42",
    }) as { key: string; linkWarning?: string };

    expect(result.key).toBe("DEV-99");
    expect(result.linkWarning).toContain("Link type not found");
  });
});

// ==================================================================
// get_active_sprint
// ==================================================================
describe("get_active_sprint", () => {
  it("happy path: returns sprint + issues + totals (v1.4 shape)", async () => {
    client.getActiveAndFutureSprints.mockResolvedValueOnce([activeSprint]);
    client.getSprintIssues.mockResolvedValueOnce([
      makeIssue({ key: "DEV-1", statusCategory: "inprogress", storyPoints: 3 }),
      makeIssue({ key: "DEV-2", statusCategory: "done", storyPoints: 5 }),
      makeIssue({ key: "DEV-3", statusCategory: "todo", storyPoints: null }),
    ]);

    const result = await getSprint.handler({}) as {
      sprint: { id: number; name: string };
      activeSprints: { id: number; name: string }[];
      futureSprints: { id: number }[];
      issuesByStatus: {
        todo: IssueSummary[];
        inprogress: IssueSummary[];
        codereview: IssueSummary[];
        done: IssueSummary[];
      };
      totals: {
        total: number;
        todo: number;
        inprogress: number;
        codereview: number;
        done: number;
        blocked: number;
        storyPointsTotal: number;
        storyPointsDone: number;
      };
    };

    expect(result.sprint.id).toBe(55);
    expect(result.futureSprints).toHaveLength(0); // v1.4: futureSprints present
    expect(result.issuesByStatus.inprogress).toHaveLength(1);
    expect(result.issuesByStatus.codereview).toHaveLength(0);
    expect(result.issuesByStatus.done).toHaveLength(1);
    expect(result.issuesByStatus.todo).toHaveLength(1);
    expect(result.totals.total).toBe(3);
    expect(result.totals.codereview).toBe(0);
    expect(result.totals.storyPointsTotal).toBe(8);
    expect(result.totals.storyPointsDone).toBe(5);
  });

  it("codereview bucket: inprogress 'Code Review' issue lands in codereview, not inprogress (v1.2)", async () => {
    client.getActiveAndFutureSprints.mockResolvedValueOnce([activeSprint]);
    client.getSprintIssues.mockResolvedValueOnce([
      makeIssue({ key: "DEV-1", statusCategory: "inprogress", status: "Code Review", storyPoints: 2 }),
      makeIssue({ key: "DEV-2", statusCategory: "inprogress", status: "In Progress", storyPoints: 3 }),
      makeIssue({ key: "DEV-3", statusCategory: "done", storyPoints: 5 }),
    ]);

    const result = await getSprint.handler({}) as {
      issuesByStatus: {
        todo: IssueSummary[];
        inprogress: IssueSummary[];
        codereview: IssueSummary[];
        done: IssueSummary[];
      };
      totals: { inprogress: number; codereview: number; done: number };
    };

    // DEV-1 must be in codereview, NOT inprogress
    expect(result.issuesByStatus.codereview.map((i) => i.key)).toContain("DEV-1");
    expect(result.issuesByStatus.inprogress.map((i) => i.key)).not.toContain("DEV-1");
    // DEV-2 stays in inprogress
    expect(result.issuesByStatus.inprogress.map((i) => i.key)).toContain("DEV-2");
    // totals reflect bucket counts
    expect(result.totals.codereview).toBe(1);
    expect(result.totals.inprogress).toBe(1);
    expect(result.totals.done).toBe(1);
  });

  it("codereview: other default review statuses are detected case-insensitively", async () => {
    client.getActiveAndFutureSprints.mockResolvedValueOnce([activeSprint]);
    client.getSprintIssues.mockResolvedValueOnce([
      makeIssue({ key: "DEV-1", statusCategory: "inprogress", status: "In Review" }),
      makeIssue({ key: "DEV-2", statusCategory: "inprogress", status: "Peer Review" }),
      makeIssue({ key: "DEV-3", statusCategory: "inprogress", status: "Review" }),
      makeIssue({ key: "DEV-4", statusCategory: "inprogress", status: "REVIEW" }),
    ]);

    const result = await getSprint.handler({}) as {
      issuesByStatus: { codereview: IssueSummary[]; inprogress: IssueSummary[] };
      totals: { codereview: number; inprogress: number };
    };

    // All four should be in codereview
    expect(result.totals.codereview).toBe(4);
    expect(result.totals.inprogress).toBe(0);
  });

  it("codereview: done-category 'Reviewed' status is NOT code review", async () => {
    client.getActiveAndFutureSprints.mockResolvedValueOnce([activeSprint]);
    client.getSprintIssues.mockResolvedValueOnce([
      makeIssue({ key: "DEV-1", statusCategory: "done", status: "Reviewed" }),
    ]);

    const result = await getSprint.handler({}) as {
      issuesByStatus: { done: IssueSummary[]; codereview: IssueSummary[] };
    };

    expect(result.issuesByStatus.done.map((i) => i.key)).toContain("DEV-1");
    expect(result.issuesByStatus.codereview).toHaveLength(0);
  });

  it("codereview: custom JIRA_CODE_REVIEW_STATUSES via env", async () => {
    process.env["JIRA_CODE_REVIEW_STATUSES"] = "awaiting review,qa";
    resetConfigCache();

    client.getActiveAndFutureSprints.mockResolvedValueOnce([activeSprint]);
    client.getSprintIssues.mockResolvedValueOnce([
      makeIssue({ key: "DEV-1", statusCategory: "inprogress", status: "Awaiting Review" }),
      makeIssue({ key: "DEV-2", statusCategory: "inprogress", status: "Code Review" }),
      makeIssue({ key: "DEV-3", statusCategory: "inprogress", status: "QA" }),
    ]);

    const result = await getSprint.handler({}) as {
      issuesByStatus: { codereview: IssueSummary[]; inprogress: IssueSummary[] };
      totals: { codereview: number; inprogress: number };
    };

    // DEV-1 and DEV-3 match custom statuses; DEV-2 ("Code Review") does NOT match custom list
    expect(result.issuesByStatus.codereview.map((i) => i.key)).toContain("DEV-1");
    expect(result.issuesByStatus.codereview.map((i) => i.key)).toContain("DEV-3");
    expect(result.issuesByStatus.inprogress.map((i) => i.key)).toContain("DEV-2");
    expect(result.totals.codereview).toBe(2);
    expect(result.totals.inprogress).toBe(1);
  });

  it("activeSprints contains all active sprints, latest-first (v1.4: also has futureSprints)", async () => {
    client.getActiveAndFutureSprints.mockResolvedValueOnce([olderSprint, activeSprint]);
    client.getSprintIssues.mockResolvedValueOnce([]);

    const result = await getSprint.handler({}) as {
      sprint: { id: number };
      activeSprints: { id: number; name: string; startDate: string | null; endDate: string | null; goal: string | null }[];
      futureSprints: { id: number }[];
    };

    // activeSprints should be sorted latest-first
    expect(result.activeSprints).toHaveLength(2);
    expect(result.activeSprints[0]!.id).toBe(55); // activeSprint — later startDate
    expect(result.activeSprints[1]!.id).toBe(44); // olderSprint — earlier startDate
    expect(result.futureSprints).toHaveLength(0);

    // Default selection: latest (first in sorted list)
    expect(result.sprint.id).toBe(55);
  });

  it("selects sprint by explicit sprintId", async () => {
    client.getActiveAndFutureSprints.mockResolvedValueOnce([olderSprint, activeSprint]);
    client.getSprintIssues.mockResolvedValueOnce([]);

    const result = await getSprint.handler({ sprintId: 44 }) as {
      sprint: { id: number };
    };

    expect(result.sprint.id).toBe(44);
    expect(client.getSprintIssues).toHaveBeenCalledWith(44, 50);
  });

  it("throws UPSTREAM error when sprintId is not an active or future sprint on the board (v1.4 message)", async () => {
    client.getActiveAndFutureSprints.mockResolvedValueOnce([activeSprint]);

    await expect(getSprint.handler({ sprintId: 999 })).rejects.toThrow(
      "Sprint 999 is not an active or future sprint on board 10002"
    );
  });

  it("uses JIRA_DEV_BOARD_ID as default boardId", async () => {
    client.getActiveAndFutureSprints.mockResolvedValueOnce([activeSprint]);
    client.getSprintIssues.mockResolvedValueOnce([]);

    await getSprint.handler({});
    expect(client.getActiveAndFutureSprints).toHaveBeenCalledWith(10002);
  });

  it("returns UPSTREAM error when no active or future sprint (v1.4 message)", async () => {
    client.getActiveAndFutureSprints.mockResolvedValueOnce([]);

    await expect(getSprint.handler({})).rejects.toThrow(
      "No active or future sprint found for board 10002"
    );
  });

  it("counts blocked issues in totals regardless of status bucket", async () => {
    client.getActiveAndFutureSprints.mockResolvedValueOnce([activeSprint]);
    client.getSprintIssues.mockResolvedValueOnce([
      makeIssue({ key: "DEV-1", statusCategory: "done", blocked: true }),
      makeIssue({ key: "DEV-2", statusCategory: "inprogress", blocked: true }),
    ]);

    const result = await getSprint.handler({}) as { totals: { blocked: number } };
    expect(result.totals.blocked).toBe(2);
  });
});

// ==================================================================
// get_ticket
// ==================================================================
describe("get_ticket", () => {
  const sampleTicket = {
    key: "DEV-42",
    url: "https://test.atlassian.net/browse/DEV-42",
    summary: "A task",
    description: "Some text",
    status: "In Progress",
    statusCategory: "inprogress" as const,
    assignee: "Bob",
    reporter: "Alice",
    storyPoints: 2,
    issueType: "Task",
    labels: ["backend"],
    created: "2026-01-01T00:00:00.000+0000",
    updated: "2026-06-01T00:00:00.000+0000",
  };

  it("happy path: returns ticket data", async () => {
    client.getIssue.mockResolvedValueOnce(sampleTicket);

    const result = await getTicket.handler({ ticketKey: "DEV-42" });
    expect(result).toEqual(sampleTicket);
  });

  it("rejects ticketKey not matching PROJECT-NUMBER format", async () => {
    await expect(
      getTicket.handler({ ticketKey: "invalid-key" })
    ).rejects.toThrow("ticketKey must match PROJECT-NUMBER format");
  });

  it("rejects lowercase project key", async () => {
    await expect(
      getTicket.handler({ ticketKey: "dev-42" })
    ).rejects.toThrow();
  });

  it("surfaces 404 as UPSTREAM error", async () => {
    client.getIssue.mockRejectedValueOnce(
      new UpstreamError("Ticket DEV-99 not found", 404)
    );
    await expect(
      getTicket.handler({ ticketKey: "DEV-99" })
    ).rejects.toThrow("Ticket DEV-99 not found");
  });
});

// ==================================================================
// update_ticket
// ==================================================================
describe("update_ticket", () => {
  it("happy path: updates summary only", async () => {
    client.updateIssue.mockResolvedValueOnce(undefined);

    const result = await updateTicket.handler({
      ticketKey: "DEV-42",
      summary: "New summary",
    }) as { updatedFields: string[] };

    expect(result.updatedFields).toEqual(["summary"]);
    expect(result.updatedFields).not.toContain("description");
  });

  it("happy path: updates description only", async () => {
    client.updateIssue.mockResolvedValueOnce(undefined);

    const result = await updateTicket.handler({
      ticketKey: "DEV-42",
      description: "New description",
    }) as { updatedFields: string[] };

    expect(result.updatedFields).toEqual(["description"]);
  });

  it("happy path: updates both summary and description", async () => {
    client.updateIssue.mockResolvedValueOnce(undefined);

    const result = await updateTicket.handler({
      ticketKey: "DEV-42",
      summary: "New",
      description: "Also new",
    }) as { updatedFields: string[] };

    expect(result.updatedFields).toContain("summary");
    expect(result.updatedFields).toContain("description");
  });

  it("rejects when none of summary/description/storyPoints is provided", async () => {
    await expect(
      updateTicket.handler({ ticketKey: "DEV-42" })
    ).rejects.toThrow("At least one of summary, description, or storyPoints must be provided");
  });

  it("v1.19: updates story points (passes storyPoints to updateIssue)", async () => {
    client.updateIssue.mockResolvedValueOnce(undefined);

    const result = await updateTicket.handler({
      ticketKey: "VRDB-2700",
      storyPoints: 2,
    }) as { updatedFields: string[] };

    expect(result.updatedFields).toEqual(["storyPoints"]);
    expect(client.updateIssue).toHaveBeenCalledWith("VRDB-2700", expect.objectContaining({ storyPoints: 2 }));
  });

  it("returns correct key and url", async () => {
    client.updateIssue.mockResolvedValueOnce(undefined);

    const result = await updateTicket.handler({
      ticketKey: "PO-10",
      summary: "Updated",
    }) as { key: string; url: string };

    expect(result.key).toBe("PO-10");
    expect(result.url).toContain("PO-10");
  });

  it("surfaces 404 as UPSTREAM error", async () => {
    client.updateIssue.mockRejectedValueOnce(
      new UpstreamError("Ticket DEV-99 not found", 404)
    );

    await expect(
      updateTicket.handler({ ticketKey: "DEV-99", summary: "x" })
    ).rejects.toThrow("not found");
  });
});

// ==================================================================
// get_daily_huddle (v1.4 — now uses getActiveAndFutureSprints)
// ==================================================================
describe("get_daily_huddle", () => {
  it("happy path: returns correct buckets (v1.2 shape incl. codeReview)", async () => {
    client.getActiveAndFutureSprints.mockResolvedValueOnce([activeSprint]);
    client.getSprintIssues.mockResolvedValueOnce([
      makeIssue({ key: "DEV-1", statusCategory: "inprogress", status: "In Progress", blocked: false }),
      makeIssue({ key: "DEV-2", statusCategory: "done", blocked: false }),
      makeIssue({ key: "DEV-3", statusCategory: "todo", blocked: false }),
      makeIssue({ key: "DEV-4", statusCategory: "inprogress", status: "In Progress", blocked: true }),
    ]);

    const result = await getDailyHuddle.handler({}) as {
      inProgress: { key: string }[];
      codeReview: { key: string }[];
      blocked: { key: string }[];
      done: { key: string }[];
      upNext: { key: string }[];
      summaryText: string;
    };

    expect(result.inProgress.map((i) => i.key)).toContain("DEV-1");
    expect(result.codeReview).toHaveLength(0);
    expect(result.blocked.map((i) => i.key)).toContain("DEV-4");
    expect(result.done.map((i) => i.key)).toContain("DEV-2");
    expect(result.upNext.map((i) => i.key)).toContain("DEV-3");
  });

  it("codeReview bucket: inprogress 'Code Review' issue goes to codeReview bucket (v1.2)", async () => {
    client.getActiveAndFutureSprints.mockResolvedValueOnce([activeSprint]);
    client.getSprintIssues.mockResolvedValueOnce([
      makeIssue({ key: "DEV-1", statusCategory: "inprogress", status: "Code Review", blocked: false }),
      makeIssue({ key: "DEV-2", statusCategory: "inprogress", status: "In Progress", blocked: false }),
    ]);

    const result = await getDailyHuddle.handler({}) as {
      inProgress: { key: string }[];
      codeReview: { key: string }[];
    };

    expect(result.codeReview.map((i) => i.key)).toContain("DEV-1");
    expect(result.inProgress.map((i) => i.key)).not.toContain("DEV-1");
    expect(result.inProgress.map((i) => i.key)).toContain("DEV-2");
  });

  it("precedence: blocked code-review issue goes to blocked bucket, not codeReview (v1.2)", async () => {
    client.getActiveAndFutureSprints.mockResolvedValueOnce([activeSprint]);
    client.getSprintIssues.mockResolvedValueOnce([
      makeIssue({ key: "DEV-1", statusCategory: "inprogress", status: "Code Review", blocked: true }),
    ]);

    const result = await getDailyHuddle.handler({}) as {
      blocked: { key: string }[];
      codeReview: { key: string }[];
    };

    expect(result.blocked.map((i) => i.key)).toContain("DEV-1");
    expect(result.codeReview.map((i) => i.key)).not.toContain("DEV-1");
  });

  it("precedence: done-category 'Reviewed' status goes to done, not codeReview (v1.2)", async () => {
    client.getActiveAndFutureSprints.mockResolvedValueOnce([activeSprint]);
    client.getSprintIssues.mockResolvedValueOnce([
      makeIssue({ key: "DEV-1", statusCategory: "done", status: "Reviewed", blocked: false }),
    ]);

    const result = await getDailyHuddle.handler({}) as {
      done: { key: string }[];
      codeReview: { key: string }[];
    };

    expect(result.done.map((i) => i.key)).toContain("DEV-1");
    expect(result.codeReview.map((i) => i.key)).not.toContain("DEV-1");
  });

  it("done-wins precedence: done issue goes to done even if blocked=true", async () => {
    client.getActiveAndFutureSprints.mockResolvedValueOnce([activeSprint]);
    client.getSprintIssues.mockResolvedValueOnce([
      makeIssue({ key: "DEV-5", statusCategory: "done", blocked: true }),
    ]);

    const result = await getDailyHuddle.handler({}) as {
      done: { key: string }[];
      blocked: { key: string }[];
    };

    // Should appear in done, NOT in blocked
    expect(result.done.map((i) => i.key)).toContain("DEV-5");
    expect(result.blocked.map((i) => i.key)).not.toContain("DEV-5");
  });

  it("upNext limited to 5 items", async () => {
    client.getActiveAndFutureSprints.mockResolvedValueOnce([activeSprint]);
    const todoItems = Array.from({ length: 8 }, (_, idx) =>
      makeIssue({ key: `DEV-${idx + 10}`, statusCategory: "todo", blocked: false })
    );
    client.getSprintIssues.mockResolvedValueOnce(todoItems);

    const result = await getDailyHuddle.handler({}) as { upNext: unknown[] };
    expect(result.upNext).toHaveLength(5);
  });

  it("summaryText contains sprint name and counts (v1.2 format)", async () => {
    client.getActiveAndFutureSprints.mockResolvedValueOnce([activeSprint]);
    client.getSprintIssues.mockResolvedValueOnce([
      makeIssue({ key: "DEV-1", statusCategory: "inprogress", status: "In Progress", blocked: false }),
      makeIssue({ key: "DEV-2", statusCategory: "done", blocked: false }),
    ]);

    const result = await getDailyHuddle.handler({}) as { summaryText: string };
    expect(result.summaryText).toContain("Sprint 7");
    expect(result.summaryText).toContain("2 issues");
    expect(result.summaryText).toContain("1 in progress");
    expect(result.summaryText).toContain("0 in code review");
    expect(result.summaryText).toContain("1 done");
  });

  it("summaryText omits parenthetical when no blocked issues (v1.2 exact format)", async () => {
    client.getActiveAndFutureSprints.mockResolvedValueOnce([activeSprint]);
    client.getSprintIssues.mockResolvedValueOnce([
      makeIssue({ key: "DEV-1", statusCategory: "inprogress", status: "In Progress", blocked: false }),
    ]);

    const result = await getDailyHuddle.handler({}) as { summaryText: string };
    expect(result.summaryText).toContain("0 blocked,");
    expect(result.summaryText).not.toMatch(/blocked \(DEV/);
    expect(result.summaryText).toBe(
      "Sprint 'Sprint 7' (2026-06-01 – 2026-06-14): 1 issues — 1 in progress, 0 in code review, 0 blocked, 0 done, 0 up next."
    );
  });

  it("summaryText includes blocked keys in parenthetical when blocked > 0", async () => {
    client.getActiveAndFutureSprints.mockResolvedValueOnce([activeSprint]);
    client.getSprintIssues.mockResolvedValueOnce([
      makeIssue({ key: "DEV-1", statusCategory: "inprogress", status: "In Progress", blocked: true }),
      makeIssue({ key: "DEV-2", statusCategory: "inprogress", status: "In Progress", blocked: true }),
    ]);

    const result = await getDailyHuddle.handler({}) as { summaryText: string };
    expect(result.summaryText).toContain("2 blocked (DEV-1, DEV-2)");
  });

  it("summaryText exact format with a code-review issue (v1.2 fixture)", async () => {
    client.getActiveAndFutureSprints.mockResolvedValueOnce([activeSprint]);
    client.getSprintIssues.mockResolvedValueOnce([
      makeIssue({ key: "DEV-1", statusCategory: "inprogress", status: "In Progress", blocked: false }),
      makeIssue({ key: "DEV-2", statusCategory: "inprogress", status: "Code Review", blocked: false }),
      makeIssue({ key: "DEV-3", statusCategory: "done", status: "Done", blocked: false }),
      makeIssue({ key: "DEV-4", statusCategory: "todo", status: "To Do", blocked: false }),
    ]);

    const result = await getDailyHuddle.handler({}) as { summaryText: string };
    expect(result.summaryText).toBe(
      "Sprint 'Sprint 7' (2026-06-01 – 2026-06-14): 4 issues — 1 in progress, 1 in code review, 0 blocked, 1 done, 1 up next."
    );
  });

  it("returns UPSTREAM error when no active or future sprint (v1.4 message)", async () => {
    client.getActiveAndFutureSprints.mockResolvedValueOnce([]);
    await expect(getDailyHuddle.handler({})).rejects.toThrow(
      "No active or future sprint found for board 10002"
    );
  });

  it("includes generatedAt as ISO string", async () => {
    client.getActiveAndFutureSprints.mockResolvedValueOnce([activeSprint]);
    client.getSprintIssues.mockResolvedValueOnce([]);

    const result = await getDailyHuddle.handler({}) as { generatedAt: string };
    expect(result.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("output includes sprintId (v1.1)", async () => {
    client.getActiveAndFutureSprints.mockResolvedValueOnce([activeSprint]);
    client.getSprintIssues.mockResolvedValueOnce([]);

    const result = await getDailyHuddle.handler({}) as { sprintId: number; sprintName: string };
    expect(result.sprintId).toBe(55);
    expect(result.sprintName).toBe("Sprint 7");
  });

  it("selects sprint by explicit sprintId input", async () => {
    client.getActiveAndFutureSprints.mockResolvedValueOnce([olderSprint, activeSprint]);
    client.getSprintIssues.mockResolvedValueOnce([]);

    const result = await getDailyHuddle.handler({ sprintId: 44 }) as { sprintId: number };
    expect(result.sprintId).toBe(44);
    expect(client.getSprintIssues).toHaveBeenCalledWith(44, 50);
  });

  it("throws UPSTREAM error when explicit sprintId is not active or future on board (v1.4 message)", async () => {
    client.getActiveAndFutureSprints.mockResolvedValueOnce([activeSprint]);

    await expect(getDailyHuddle.handler({ sprintId: 999 })).rejects.toThrow(
      "Sprint 999 is not an active or future sprint on board 10002"
    );
  });

  it("defaults to latest active sprint (highest startDate) when multiple active sprints", async () => {
    client.getActiveAndFutureSprints.mockResolvedValueOnce([olderSprint, activeSprint]);
    client.getSprintIssues.mockResolvedValueOnce([]);

    const result = await getDailyHuddle.handler({}) as { sprintId: number };
    // activeSprint has later startDate — should be selected
    expect(result.sprintId).toBe(55);
  });
});

// ==================================================================
// Blocked detection (via isBlocked in jiraClient is tested in unit;
// here we test the downstream effect in tools via mock scenarios)
// ==================================================================
describe("blocked detection in get_active_sprint", () => {
  it("respects label-based blocking", async () => {
    client.getActiveAndFutureSprints.mockResolvedValueOnce([activeSprint]);
    client.getSprintIssues.mockResolvedValueOnce([
      makeIssue({ key: "DEV-X", statusCategory: "inprogress", blocked: true }),
    ]);

    const result = await getSprint.handler({}) as { totals: { blocked: number } };
    expect(result.totals.blocked).toBe(1);
  });

  it("respects status-based blocking", async () => {
    client.getActiveAndFutureSprints.mockResolvedValueOnce([activeSprint]);
    client.getSprintIssues.mockResolvedValueOnce([
      makeIssue({ key: "DEV-Y", statusCategory: "inprogress", blocked: true, status: "Blocked" }),
    ]);

    const result = await getSprint.handler({}) as { totals: { blocked: number } };
    expect(result.totals.blocked).toBe(1);
  });
});

// ==================================================================
// v1.22 (ADR-034) — linked PRs from Jira Development Information
// ==================================================================
describe("parseDevStatusPullRequests (v1.22, pure)", () => {
  it("maps PRs with approvals + derives repo/status/decision", () => {
    const prs = parseDevStatusPullRequests({
      detail: [
        {
          pullRequests: [
            {
              id: "#10", name: "VRDB-1: add login", url: "https://github.com/org/web/pull/10",
              status: "OPEN", lastUpdate: "t",
              reviewers: [
                { name: "Alice", approvalStatus: "APPROVED" },
                { name: "Bob", approvalStatus: "UNAPPROVED" },
              ],
            },
          ],
        },
      ],
    });
    expect(prs).toHaveLength(1);
    expect(prs[0]).toMatchObject({
      url: "https://github.com/org/web/pull/10",
      title: "VRDB-1: add login",
      repo: "org/web",
      status: "open",
      decision: "approved",
      approvals: 1,
      reviewers: ["Alice"],
    });
  });

  it("changes_requested wins; uses repositoryName when present", () => {
    const prs = parseDevStatusPullRequests({
      detail: [{ pullRequests: [{
        url: "https://github.com/org/api/pull/5", name: "fix", status: "OPEN",
        repositoryName: "org/api",
        reviewers: [{ name: "A", approvalStatus: "APPROVED" }, { name: "B", approvalStatus: "CHANGES_REQUESTED" }],
      }] }],
    });
    expect(prs[0]!.decision).toBe("changes_requested");
    expect(prs[0]!.repo).toBe("org/api");
  });

  it("no reviewers → review_required; MERGED/DECLINED status mapped", () => {
    const prs = parseDevStatusPullRequests({
      detail: [{ pullRequests: [
        { url: "https://x/y/pull/1", status: "MERGED" },
        { url: "https://x/y/pull/2", status: "DECLINED" },
      ] }],
    });
    expect(prs[0]!.decision).toBe("review_required");
    expect(prs[0]!.status).toBe("merged");
    expect(prs[1]!.status).toBe("declined");
  });

  it("tolerates empty / missing detail", () => {
    expect(parseDevStatusPullRequests({})).toEqual([]);
    expect(parseDevStatusPullRequests({ detail: [] })).toEqual([]);
    expect(parseDevStatusPullRequests({ detail: [{}] })).toEqual([]);
  });

  it("skips PRs with no url", () => {
    const prs = parseDevStatusPullRequests({ detail: [{ pullRequests: [{ name: "no url" }] }] });
    expect(prs).toEqual([]);
  });
});

describe("get_issue_pull_requests (v1.22)", () => {
  it("resolves id then dev-status per key, keyed by issue key", async () => {
    client.getIssueNumericId.mockImplementation(async (k: string) => (k === "VRDB-1" ? "1001" : null));
    client.getDevStatusPullRequestsRaw.mockResolvedValue({
      detail: [{ pullRequests: [{ url: "https://github.com/o/r/pull/3", name: "PR", status: "OPEN",
        reviewers: [{ name: "Z", approvalStatus: "APPROVED" }] }] }],
    });

    const out = (await getIssuePullRequestsTool.handler({ keys: ["VRDB-1", "VRDB-9"] })) as {
      pullRequests: Record<string, Array<{ decision: string }>>;
    };
    expect(out.pullRequests["VRDB-1"]).toHaveLength(1);
    expect(out.pullRequests["VRDB-1"]![0]!.decision).toBe("approved");
    // Unknown key (id null) → empty list, never throws.
    expect(out.pullRequests["VRDB-9"]).toEqual([]);
  });

  it("is resilient — a per-key error yields [] for that key", async () => {
    client.getIssueNumericId.mockResolvedValue("1001");
    client.getDevStatusPullRequestsRaw.mockRejectedValue(new Error("dev-status 500"));
    const out = (await getIssuePullRequestsTool.handler({ keys: ["VRDB-1"] })) as {
      pullRequests: Record<string, unknown[]>;
    };
    expect(out.pullRequests["VRDB-1"]).toEqual([]);
  });

  it("rejects empty keys (validation)", async () => {
    await expect(getIssuePullRequestsTool.handler({ keys: [] })).rejects.toThrow();
  });
});
