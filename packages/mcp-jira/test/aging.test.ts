// Ticket aging — changelog-derived Work Item Age (v1.58, ADR-070). Keyless/offline.
//
// Covers the pure resolver (resolveInProgressSince) and the get_active_sprint `withAging`
// opt-in, including the guarantee that withAging:false performs ZERO changelog calls.
//
// v1.61 (ADR-073): scope amended to enrich ONLY the inprogress bucket — code review counts as
// done per the ADR-014 DoD, so code-review issues are never "aging" and never fetch changelogs.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/lib/jiraClient.js", () => ({
  getActiveAndFutureSprints: vi.fn(),
  getSprintIssues: vi.fn(),
  getIssueChangelogRaw: vi.fn(),
}));

import { resolveInProgressSince, getSprint } from "../src/tools/getSprint.js";
import * as jiraClient from "../src/lib/jiraClient.js";
import { resetConfigCache } from "../src/lib/config.js";
import type { IssueSummary } from "../src/lib/types.js";

const api = jiraClient as unknown as Record<
  "getActiveAndFutureSprints" | "getSprintIssues" | "getIssueChangelogRaw",
  ReturnType<typeof vi.fn>
>;

/** ToolDef handlers are typed `(input: unknown) => Promise<unknown>`; narrow to the slice these tests read. */
type AgedSnapshot = {
  issuesByStatus: Record<"todo" | "inprogress" | "codereview" | "done", IssueSummary[]>;
};
const runGetSprint = (input: Record<string, unknown>) => getSprint.handler(input) as Promise<AgedSnapshot>;

/** A changelog entry that moves an issue INTO `to` at `created`. */
function statusEntry(created: string, to: string, from = "To Do") {
  return { created, items: [{ field: "status", fromString: from, toString: to }] };
}

function issue(over: Partial<IssueSummary> = {}): IssueSummary {
  return {
    key: "DEV-1", summary: "Thing", status: "In Progress", statusCategory: "inprogress",
    assignee: "Alice", assigneeAccountId: "a1", storyPoints: 3, issueType: "Task",
    url: "https://j/browse/DEV-1", blocked: false, ...over,
  };
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

describe("resolveInProgressSince (pure)", () => {
  it("returns the LATEST transition into the issue's current status", () => {
    const pages = [{
      values: [
        statusEntry("2026-07-01T10:00:00.000Z", "In Progress"),
        statusEntry("2026-07-05T10:00:00.000Z", "In Progress", "Code Review"), // bounce-back — wins
        statusEntry("2026-07-03T10:00:00.000Z", "Code Review", "In Progress"),
      ],
    }];
    expect(resolveInProgressSince(pages, "In Progress")).toBe("2026-07-05T10:00:00.000Z");
  });

  it("ignores transitions into OTHER statuses", () => {
    const pages = [{ values: [statusEntry("2026-07-01T10:00:00.000Z", "Code Review")] }];
    expect(resolveInProgressSince(pages, "In Progress")).toBeNull();
  });

  it("returns null when no status transition exists (never guesses)", () => {
    const pages = [{
      values: [
        { created: "2026-07-01T10:00:00.000Z", items: [{ field: "assignee", toString: "Bob" }] },
        { created: "2026-07-02T10:00:00.000Z", items: [] },
      ],
    }];
    expect(resolveInProgressSince(pages, "In Progress")).toBeNull();
  });

  it("is order-independent across pages (takes the max, not the last seen)", () => {
    const pages = [
      { values: [statusEntry("2026-07-09T10:00:00.000Z", "In Progress")] }, // page 1 newest
      { values: [statusEntry("2026-07-02T10:00:00.000Z", "In Progress")] }, // tail page older
    ];
    expect(resolveInProgressSince(pages, "In Progress")).toBe("2026-07-09T10:00:00.000Z");
    expect(resolveInProgressSince([...pages].reverse(), "In Progress")).toBe("2026-07-09T10:00:00.000Z");
  });

  it("tolerates malformed entries (missing created / items / empty pages)", () => {
    const pages = [
      {},
      { values: [{ items: [{ field: "status", toString: "In Progress" }] }] }, // no created
      { values: [statusEntry("2026-07-04T10:00:00.000Z", "In Progress")] },
    ];
    expect(resolveInProgressSince(pages, "In Progress")).toBe("2026-07-04T10:00:00.000Z");
  });

  it("picks the status item out of a multi-item entry", () => {
    const pages = [{
      values: [{
        created: "2026-07-06T10:00:00.000Z",
        items: [
          { field: "assignee", toString: "Bob" },
          { field: "status", fromString: "To Do", toString: "In Progress" },
        ],
      }],
    }];
    expect(resolveInProgressSince(pages, "In Progress")).toBe("2026-07-06T10:00:00.000Z");
  });
});

describe("get_active_sprint withAging — enriches ONLY the in-progress bucket (v1.58 ADR-070; scope amended v1.61 ADR-073)", () => {
  beforeEach(() => {
    api.getActiveAndFutureSprints.mockResolvedValue([
      { id: 5, name: "Sprint 5", state: "active", startDate: "2026-07-01", endDate: "2026-07-14", goal: null },
    ]);
    api.getSprintIssues.mockResolvedValue([
      issue({ key: "DEV-1", status: "In Progress", statusCategory: "inprogress" }),
      issue({ key: "DEV-2", status: "Code Review", statusCategory: "inprogress" }),
      issue({ key: "DEV-3", status: "To Do", statusCategory: "todo" }),
      issue({ key: "DEV-4", status: "Done", statusCategory: "done" }),
    ]);
  });

  it("performs ZERO changelog calls by default (velocity/report paths never pay)", async () => {
    const out = await runGetSprint({ boardId: 10002 });
    expect(api.getIssueChangelogRaw).not.toHaveBeenCalled();
    expect(out.issuesByStatus.inprogress[0]!.inProgressSince).toBeUndefined();
  });

  it("enriches ONLY the in-progress bucket when withAging: true (code review counts as done, ADR-014 DoD)", async () => {
    api.getIssueChangelogRaw.mockImplementation((key: string) =>
      Promise.resolve({ values: [statusEntry("2026-07-08T10:00:00.000Z", key === "DEV-2" ? "Code Review" : "In Progress")], total: 1, isLast: true })
    );

    const out = await runGetSprint({ boardId: 10002, withAging: true });

    // only DEV-1 is genuinely in-progress → 1 call; DEV-2 (Code Review) is never enriched.
    expect(api.getIssueChangelogRaw).toHaveBeenCalledTimes(1);
    const keys = api.getIssueChangelogRaw.mock.calls.map((c) => c[0]).sort();
    expect(keys).toEqual(["DEV-1"]);

    expect(out.issuesByStatus.inprogress[0]!.inProgressSince).toBe("2026-07-08T10:00:00.000Z");
    // codereview is never touched — inProgressSince stays undefined, distinct from the
    // enriched-but-unresolvable `null` an in-progress issue would get.
    expect(out.issuesByStatus.codereview[0]!.inProgressSince).toBeUndefined();
    expect(out.issuesByStatus.todo[0]!.inProgressSince).toBeUndefined();
  });

  it("fetches the tail page when the history is longer than one page", async () => {
    api.getIssueChangelogRaw.mockImplementation((_key: string, startAt: number) =>
      startAt === 0
        ? Promise.resolve({ values: [statusEntry("2026-07-02T10:00:00.000Z", "In Progress")], total: 150, isLast: false })
        : Promise.resolve({ values: [statusEntry("2026-07-07T10:00:00.000Z", "In Progress")], total: 150, isLast: true })
    );

    const out = await runGetSprint({ boardId: 10002, withAging: true });

    // page 1 + tail page at total-100 = 50, for the single in-flight issue (DEV-1 only)
    expect(api.getIssueChangelogRaw).toHaveBeenCalledTimes(2);
    expect(api.getIssueChangelogRaw).toHaveBeenCalledWith("DEV-1", 50, 100);
    // the tail page's newer transition wins
    expect(out.issuesByStatus.inprogress[0]!.inProgressSince).toBe("2026-07-07T10:00:00.000Z");
  });

  it("degrades to null when a changelog fetch fails (per-key resilience, no throw)", async () => {
    api.getIssueChangelogRaw.mockRejectedValue(new Error("Jira 500"));
    const out = await runGetSprint({ boardId: 10002, withAging: true });
    expect(out.issuesByStatus.inprogress[0]!.inProgressSince).toBeNull();
    // codereview was never fetched at all — stays undefined, not the fetched-and-failed null.
    expect(out.issuesByStatus.codereview[0]!.inProgressSince).toBeUndefined();
  });

  it("resolves null when the changelog has no transition into the current status", async () => {
    api.getIssueChangelogRaw.mockResolvedValue({ values: [statusEntry("2026-07-01T10:00:00.000Z", "Blocked")], total: 1, isLast: true });
    const out = await runGetSprint({ boardId: 10002, withAging: true });
    expect(out.issuesByStatus.inprogress[0]!.inProgressSince).toBeNull();
  });
});
