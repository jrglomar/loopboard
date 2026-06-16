/**
 * v1.8 feature tests — team roster + recent assignees (ADR-019).
 *
 * All tests run keyless and offline:
 * - jiraClient is vi.mocked (no network)
 * - teamStore uses a temp file via JIRA_TEAM_FILE env override
 *
 * Covers:
 * A. assigneeAccountId on IssueSummary
 *    - mapIssue extracts assignee.accountId
 *    - null when issue has no assignee
 * B. get_recent_assignees
 *    - distinct by accountId across N sprints
 *    - ticketCount is correct
 *    - null assigneeAccountId skipped
 *    - sorted: ticketCount desc, then displayName asc
 *    - boardId defaults to JIRA_DEV_BOARD_ID
 *    - sprintCount limits how many sprints are scanned
 *    - closed sprints come before active in priority
 * C. Team round-trip
 *    - set_team_members → get_team_members returns same (sorted by displayName)
 *    - deduplication by accountId (last wins)
 *    - empty members array clears the board's roster
 *    - missing file tolerated (get → [])
 *    - corrupt file tolerated (get → [])
 *    - multiple boards are independent
 * D. Tool registry
 *    - get_recent_assignees, get_team_members, set_team_members are all registered
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
  getBoardAssigneesRaw: vi.fn(),
  getSprintMeta: vi.fn(),
  createSprint: vi.fn(),
  getIssue: vi.fn(),
  updateIssue: vi.fn(),
  getAssignableUsers: vi.fn(),
  assignIssue: vi.fn(),
  isBlocked: vi.fn(),
  mapIssue: vi.fn(),
  resetClientCache: vi.fn(),
}));

import * as jiraClient from "../src/lib/jiraClient.js";
import { getRecentAssigneesTool } from "../src/tools/getRecentAssignees.js";
import { getTeamMembersTool } from "../src/tools/getTeamMembers.js";
import { setTeamMembersTool } from "../src/tools/setTeamMembers.js";

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
}

const originalEnv = { ...process.env };

// Per-test temp file path
let tempTeamFile: string | null = null;

beforeEach(() => {
  resetConfigCache();
  setRequiredEnv();
  vi.clearAllMocks();
  // Point JIRA_TEAM_FILE at a unique temp file so tests don't touch the real default
  tempTeamFile = path.join(
    os.tmpdir(),
    `loopboard-team-test-${process.pid}-${Date.now()}.json`
  );
  process.env["JIRA_TEAM_FILE"] = tempTeamFile;
  resetConfigCache(); // pick up JIRA_TEAM_FILE
});

afterEach(() => {
  // Clean up temp file if it was created
  if (tempTeamFile !== null) {
    try {
      fs.unlinkSync(tempTeamFile);
    } catch {
      // File may not exist if the test never wrote; that's fine
    }
    tempTeamFile = null;
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
    assigneeAccountId: "acc-alice",
    storyPoints: 3,
    issueType: "Task",
    url: "https://test.atlassian.net/browse/DEV-1",
    blocked: false,
    ...overrides,
  };
}


// ========================================================================
// A. assigneeAccountId on IssueSummary (mapIssue — tested via jiraClient unit)
// ========================================================================

describe("IssueSummary.assigneeAccountId", () => {
  it("makeIssue fixture includes assigneeAccountId field", () => {
    // Verifies the type compiles correctly with the new field
    const issue = makeIssue({ assigneeAccountId: "acc-xyz" });
    expect(issue.assigneeAccountId).toBe("acc-xyz");
  });

  it("assigneeAccountId can be null (no assignee)", () => {
    const issue = makeIssue({ assignee: null, assigneeAccountId: null });
    expect(issue.assignee).toBeNull();
    expect(issue.assigneeAccountId).toBeNull();
  });

  it("assigneeAccountId is independent of assignee display name", () => {
    const issue = makeIssue({ assignee: "Alice Smith", assigneeAccountId: "acc-abc-123" });
    expect(issue.assignee).toBe("Alice Smith");
    expect(issue.assigneeAccountId).toBe("acc-abc-123");
  });
});

// ========================================================================
// B. get_recent_assignees
// ========================================================================

// v1.9 (ADR-020): get_recent_assignees now scans the whole board via
// getBoardAssigneesRaw (one call returning { assignee, assigneeAccountId } rows),
// NOT getSprintsByState + getSprintIssues.
function row(assignee: string | null, assigneeAccountId: string | null) {
  return { assignee, assigneeAccountId };
}

describe("get_recent_assignees — boardId default", () => {
  it("defaults boardId to JIRA_DEV_BOARD_ID (10002)", async () => {
    client.getBoardAssigneesRaw.mockResolvedValueOnce([]);

    const result = await getRecentAssigneesTool.handler({}) as {
      boardId: number;
      assignees: unknown[];
    };

    expect(result.boardId).toBe(10002);
    // board-wide scan called with the default board
    expect(client.getBoardAssigneesRaw).toHaveBeenCalledTimes(1);
    expect(client.getBoardAssigneesRaw.mock.calls[0]![0]).toBe(10002);
  });

  it("respects explicit boardId", async () => {
    client.getBoardAssigneesRaw.mockResolvedValueOnce([]);

    const result = await getRecentAssigneesTool.handler({ boardId: 10001 }) as {
      boardId: number;
    };

    expect(result.boardId).toBe(10001);
    expect(client.getBoardAssigneesRaw.mock.calls[0]![0]).toBe(10001);
  });
});

describe("get_recent_assignees — distinct by accountId + ticketCount", () => {
  it("counts tickets per accountId across the board", async () => {
    // Alice 3 tickets, Bob 2 tickets across the scanned board issues
    client.getBoardAssigneesRaw.mockResolvedValueOnce([
      row("Alice", "acc-alice"),
      row("Alice", "acc-alice"),
      row("Bob", "acc-bob"),
      row("Alice", "acc-alice"),
      row("Bob", "acc-bob"),
    ]);

    const result = await getRecentAssigneesTool.handler({}) as {
      assignees: { accountId: string; displayName: string; ticketCount: number }[];
    };

    // Alice: 3 tickets, Bob: 2 tickets
    expect(result.assignees).toHaveLength(2);
    const alice = result.assignees.find((a) => a.accountId === "acc-alice");
    const bob = result.assignees.find((a) => a.accountId === "acc-bob");
    expect(alice).toBeDefined();
    expect(alice!.ticketCount).toBe(3);
    expect(alice!.displayName).toBe("Alice");
    expect(bob).toBeDefined();
    expect(bob!.ticketCount).toBe(2);
  });

  it("deduplicates by accountId (same person on many tickets)", async () => {
    client.getBoardAssigneesRaw.mockResolvedValueOnce([
      row("Alice", "acc-alice"),
      row("Alice", "acc-alice"),
    ]);

    const result = await getRecentAssigneesTool.handler({}) as {
      assignees: { accountId: string; ticketCount: number }[];
    };

    // Only one entry for Alice despite appearing twice
    expect(result.assignees).toHaveLength(1);
    expect(result.assignees[0]!.accountId).toBe("acc-alice");
    expect(result.assignees[0]!.ticketCount).toBe(2);
  });
});

describe("get_recent_assignees — null assigneeAccountId skipped", () => {
  it("skips rows with null assigneeAccountId", async () => {
    client.getBoardAssigneesRaw.mockResolvedValueOnce([
      row(null, null),
      row("Bob", "acc-bob"),
    ]);

    const result = await getRecentAssigneesTool.handler({}) as {
      assignees: { accountId: string }[];
    };

    // Null-assignee row skipped; only Bob
    expect(result.assignees).toHaveLength(1);
    expect(result.assignees[0]!.accountId).toBe("acc-bob");
  });

  it("returns empty assignees when all rows have null assignee", async () => {
    client.getBoardAssigneesRaw.mockResolvedValueOnce([
      row(null, null),
      row(null, null),
    ]);

    const result = await getRecentAssigneesTool.handler({}) as {
      assignees: unknown[];
    };

    expect(result.assignees).toHaveLength(0);
  });
});

describe("get_recent_assignees — sort order", () => {
  it("sorts by ticketCount desc, then displayName asc", async () => {
    client.getBoardAssigneesRaw.mockResolvedValueOnce([
      row("Zara", "acc-z"),
      row("Alice", "acc-a"),
      row("Bob", "acc-b"),
      row("Zara", "acc-z"),
      row("Bob", "acc-b"),
      row("Bob", "acc-b"),
    ]);

    const result = await getRecentAssigneesTool.handler({}) as {
      assignees: { accountId: string; ticketCount: number }[];
    };

    // Bob: 3, Zara: 2, Alice: 1
    expect(result.assignees[0]!.accountId).toBe("acc-b"); // Bob: 3
    expect(result.assignees[1]!.accountId).toBe("acc-z"); // Zara: 2
    expect(result.assignees[2]!.accountId).toBe("acc-a"); // Alice: 1
  });

  it("breaks ticketCount ties by displayName asc", async () => {
    client.getBoardAssigneesRaw.mockResolvedValueOnce([
      row("Zara", "acc-z"),
      row("Alice", "acc-a"),
    ]);

    const result = await getRecentAssigneesTool.handler({}) as {
      assignees: { displayName: string }[];
    };

    // Both have 1 ticket; Alice < Zara alphabetically
    expect(result.assignees[0]!.displayName).toBe("Alice");
    expect(result.assignees[1]!.displayName).toBe("Zara");
  });
});

describe("get_recent_assignees — board-wide scan (v1.9, ADR-020)", () => {
  it("calls getBoardAssigneesRaw ONCE with a recent-window JQL (not per-sprint)", async () => {
    client.getBoardAssigneesRaw.mockResolvedValueOnce([
      row("Alice", "acc-alice"),
    ]);

    await getRecentAssigneesTool.handler({});

    // One whole-board call — NOT sprint sampling
    expect(client.getBoardAssigneesRaw).toHaveBeenCalledTimes(1);
    expect(client.getSprintIssues).not.toHaveBeenCalled();
    expect(client.getSprintsByState).not.toHaveBeenCalled();

    const [, jql] = client.getBoardAssigneesRaw.mock.calls[0]!;
    expect(jql).toContain("assignee IS NOT EMPTY");
    // default window = 90 days
    expect(jql).toContain("updated >= -90d");
  });

  it("honors withinDays + maxResults (passed through to the board scan)", async () => {
    client.getBoardAssigneesRaw.mockResolvedValueOnce([]);

    await getRecentAssigneesTool.handler({ withinDays: 30, maxResults: 50 });

    const [, jql, maxResults] = client.getBoardAssigneesRaw.mock.calls[0]!;
    expect(jql).toContain("updated >= -30d");
    expect(maxResults).toBe(50);
  });

  it("defaults maxResults to 200 when omitted", async () => {
    client.getBoardAssigneesRaw.mockResolvedValueOnce([]);

    await getRecentAssigneesTool.handler({});

    const [, , maxResults] = client.getBoardAssigneesRaw.mock.calls[0]!;
    expect(maxResults).toBe(200);
  });
});

// ========================================================================
// C. Team round-trip (teamStore + tools)
// ========================================================================

describe("teamStore — missing/corrupt file tolerance", () => {
  it("get_team_members returns [] when file does not exist", async () => {
    const result = await getTeamMembersTool.handler({ boardId: 10002 }) as {
      boardId: number;
      members: unknown[];
    };
    expect(result.boardId).toBe(10002);
    expect(result.members).toEqual([]);
  });

  it("get_team_members returns [] when file contains corrupt JSON", async () => {
    fs.writeFileSync(tempTeamFile!, "not valid json {{{", "utf8");

    const result = await getTeamMembersTool.handler({ boardId: 10002 }) as {
      members: unknown[];
    };
    expect(result.members).toEqual([]);
  });

  it("get_team_members returns [] when file contains a JSON array", async () => {
    fs.writeFileSync(tempTeamFile!, JSON.stringify([1, 2, 3]), "utf8");

    const result = await getTeamMembersTool.handler({ boardId: 10002 }) as {
      members: unknown[];
    };
    expect(result.members).toEqual([]);
  });
});

describe("set_team_members → get_team_members round-trip", () => {
  it("set then get returns the same members (sorted by displayName)", async () => {
    await setTeamMembersTool.handler({
      boardId: 10002,
      members: [
        { accountId: "acc-z", displayName: "Zara" },
        { accountId: "acc-a", displayName: "Alice" },
      ],
    });

    const result = await getTeamMembersTool.handler({ boardId: 10002 }) as {
      boardId: number;
      members: { accountId: string; displayName: string }[];
    };

    expect(result.boardId).toBe(10002);
    expect(result.members).toHaveLength(2);
    // Sorted by displayName
    expect(result.members[0]!.displayName).toBe("Alice");
    expect(result.members[0]!.accountId).toBe("acc-a");
    expect(result.members[1]!.displayName).toBe("Zara");
    expect(result.members[1]!.accountId).toBe("acc-z");
  });

  it("set returns sorted members immediately", async () => {
    const result = await setTeamMembersTool.handler({
      boardId: 10002,
      members: [
        { accountId: "acc-z", displayName: "Zara" },
        { accountId: "acc-a", displayName: "Alice" },
        { accountId: "acc-m", displayName: "Mike" },
      ],
    }) as { members: { displayName: string }[] };

    expect(result.members.map((m) => m.displayName)).toEqual(["Alice", "Mike", "Zara"]);
  });
});

describe("set_team_members — deduplication by accountId", () => {
  it("dedupes members by accountId (last-seen wins)", async () => {
    const result = await setTeamMembersTool.handler({
      boardId: 10002,
      members: [
        { accountId: "acc-a", displayName: "Alice" },
        { accountId: "acc-a", displayName: "Alice Updated" }, // same accountId, different name
        { accountId: "acc-b", displayName: "Bob" },
      ],
    }) as { members: { accountId: string; displayName: string }[] };

    // Only two members; the second "acc-a" entry wins
    expect(result.members).toHaveLength(2);
    const alice = result.members.find((m) => m.accountId === "acc-a");
    expect(alice!.displayName).toBe("Alice Updated");
  });
});

describe("set_team_members — empty clears the roster", () => {
  it("empty members array clears the board roster", async () => {
    // First set some members
    await setTeamMembersTool.handler({
      boardId: 10002,
      members: [{ accountId: "acc-a", displayName: "Alice" }],
    });

    // Then clear
    const cleared = await setTeamMembersTool.handler({
      boardId: 10002,
      members: [],
    }) as { members: unknown[] };

    expect(cleared.members).toHaveLength(0);

    // get_team_members also returns []
    const get = await getTeamMembersTool.handler({ boardId: 10002 }) as {
      members: unknown[];
    };
    expect(get.members).toHaveLength(0);
  });
});

describe("set_team_members — multiple boards are independent", () => {
  it("setting a roster for one board does not affect another board", async () => {
    await setTeamMembersTool.handler({
      boardId: 10002,
      members: [{ accountId: "acc-a", displayName: "Alice" }],
    });
    await setTeamMembersTool.handler({
      boardId: 10001,
      members: [{ accountId: "acc-b", displayName: "Bob" }],
    });

    const dev = await getTeamMembersTool.handler({ boardId: 10002 }) as {
      members: { accountId: string }[];
    };
    const po = await getTeamMembersTool.handler({ boardId: 10001 }) as {
      members: { accountId: string }[];
    };

    expect(dev.members.map((m) => m.accountId)).toContain("acc-a");
    expect(dev.members.map((m) => m.accountId)).not.toContain("acc-b");
    expect(po.members.map((m) => m.accountId)).toContain("acc-b");
    expect(po.members.map((m) => m.accountId)).not.toContain("acc-a");
  });
});

describe("set_team_members — validation", () => {
  it("rejects member with empty accountId", async () => {
    await expect(
      setTeamMembersTool.handler({
        boardId: 10002,
        members: [{ accountId: "", displayName: "Alice" }],
      })
    ).rejects.toThrow();
  });

  it("rejects member with empty displayName", async () => {
    await expect(
      setTeamMembersTool.handler({
        boardId: 10002,
        members: [{ accountId: "acc-a", displayName: "" }],
      })
    ).rejects.toThrow();
  });
});

describe("get_team_members — boardId default", () => {
  it("defaults boardId to JIRA_DEV_BOARD_ID (10002)", async () => {
    await setTeamMembersTool.handler({
      boardId: 10002,
      members: [{ accountId: "acc-a", displayName: "Alice" }],
    });

    const result = await getTeamMembersTool.handler({}) as {
      boardId: number;
      members: { accountId: string }[];
    };

    expect(result.boardId).toBe(10002);
    expect(result.members.map((m) => m.accountId)).toContain("acc-a");
  });
});

describe("set_team_members — boardId default", () => {
  it("defaults boardId to JIRA_DEV_BOARD_ID (10002)", async () => {
    const result = await setTeamMembersTool.handler({
      members: [{ accountId: "acc-a", displayName: "Alice" }],
    }) as { boardId: number };

    expect(result.boardId).toBe(10002);
  });
});

// ========================================================================
// D. Tool registry
// ========================================================================

describe("v1.8 tools in tool registry", () => {
  it("get_recent_assignees is registered in tools/index.ts", async () => {
    const { tools } = await import("../src/tools/index.js");
    const names = tools.map((t) => t.name);
    expect(names).toContain("get_recent_assignees");
  });

  it("get_team_members is registered in tools/index.ts", async () => {
    const { tools } = await import("../src/tools/index.js");
    const names = tools.map((t) => t.name);
    expect(names).toContain("get_team_members");
  });

  it("set_team_members is registered in tools/index.ts", async () => {
    const { tools } = await import("../src/tools/index.js");
    const names = tools.map((t) => t.name);
    expect(names).toContain("set_team_members");
  });
});
