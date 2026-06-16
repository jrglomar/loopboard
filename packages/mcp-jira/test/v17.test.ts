/**
 * v1.7 feature tests — get_assignable_users + assign_issue (ADR-018).
 *
 * All tests run keyless and offline:
 * - jiraClient is vi.mocked (no network)
 * - process.env is set to valid values in beforeEach; resetConfigCache() is called
 *
 * Covers:
 * A. get_assignable_users
 *    - projectKey resolution: explicit projectKey wins
 *    - projectKey resolution: PO boardId → JIRA_PO_PROJECT_KEY
 *    - projectKey resolution: Dev boardId → JIRA_DEV_PROJECT_KEY
 *    - projectKey resolution: unknown boardId → default JIRA_DEV_PROJECT_KEY
 *    - projectKey resolution: no boardId, no projectKey → default JIRA_DEV_PROJECT_KEY
 *    - active-only filter: inactive users are dropped
 *    - sort by displayName (locale compare)
 *    - maxResults passthrough to jiraClient
 *    - output shape: { projectKey, users: AssignableUser[] }
 * B. assign_issue
 *    - happy assign (accountId string) → assigned: true
 *    - unassign (null) → assigned: false
 *    - 404 → UPSTREAM "Ticket <key> not found"
 *    - bad ticketKey format → VALIDATION (zod throws)
 *    - empty accountId string → VALIDATION (zod throws, min length 1)
 * C. Tool registry
 *    - get_assignable_users is registered in tools/index.ts
 *    - assign_issue is registered in tools/index.ts
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
  getSprintIssuesRaw: vi.fn(),
  getSprintsByState: vi.fn(),
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
import { getAssignableUsersTool } from "../src/tools/getAssignableUsers.js";
import { assignIssueTool } from "../src/tools/assignIssue.js";
import type { AssignableUser } from "../src/lib/types.js";

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

// ---- User fixtures ----

function makeUser(overrides: Partial<AssignableUser> = {}): AssignableUser {
  return {
    accountId: "acc-1",
    displayName: "Alice Smith",
    active: true,
    ...overrides,
  };
}

// ========================================================================
// A. get_assignable_users
// ========================================================================

describe("get_assignable_users — projectKey resolution", () => {
  it("explicit projectKey wins over boardId", async () => {
    client.getAssignableUsers.mockResolvedValueOnce([makeUser()]);

    const result = await getAssignableUsersTool.handler({
      projectKey: "CUSTOM",
      boardId: 10002,
    }) as { projectKey: string; users: AssignableUser[] };

    expect(result.projectKey).toBe("CUSTOM");
    expect(client.getAssignableUsers).toHaveBeenCalledWith("CUSTOM", expect.any(Number));
  });

  it("PO boardId resolves to JIRA_PO_PROJECT_KEY", async () => {
    client.getAssignableUsers.mockResolvedValueOnce([]);

    const result = await getAssignableUsersTool.handler({
      boardId: 10001,
    }) as { projectKey: string };

    expect(result.projectKey).toBe("PO");
    expect(client.getAssignableUsers).toHaveBeenCalledWith("PO", expect.any(Number));
  });

  it("Dev boardId resolves to JIRA_DEV_PROJECT_KEY", async () => {
    client.getAssignableUsers.mockResolvedValueOnce([]);

    const result = await getAssignableUsersTool.handler({
      boardId: 10002,
    }) as { projectKey: string };

    expect(result.projectKey).toBe("DEV");
    expect(client.getAssignableUsers).toHaveBeenCalledWith("DEV", expect.any(Number));
  });

  it("unknown boardId defaults to JIRA_DEV_PROJECT_KEY", async () => {
    client.getAssignableUsers.mockResolvedValueOnce([]);

    const result = await getAssignableUsersTool.handler({
      boardId: 99999,
    }) as { projectKey: string };

    expect(result.projectKey).toBe("DEV");
    expect(client.getAssignableUsers).toHaveBeenCalledWith("DEV", expect.any(Number));
  });

  it("no boardId and no projectKey defaults to JIRA_DEV_PROJECT_KEY", async () => {
    client.getAssignableUsers.mockResolvedValueOnce([]);

    const result = await getAssignableUsersTool.handler({}) as { projectKey: string };

    expect(result.projectKey).toBe("DEV");
    expect(client.getAssignableUsers).toHaveBeenCalledWith("DEV", expect.any(Number));
  });
});

describe("get_assignable_users — active-only filter", () => {
  it("drops inactive users", async () => {
    client.getAssignableUsers.mockResolvedValueOnce([
      makeUser({ accountId: "acc-1", displayName: "Alice", active: true }),
      makeUser({ accountId: "acc-2", displayName: "Bob", active: false }),
      makeUser({ accountId: "acc-3", displayName: "Carol", active: true }),
    ]);

    const result = await getAssignableUsersTool.handler({}) as {
      users: AssignableUser[];
    };

    expect(result.users).toHaveLength(2);
    expect(result.users.map((u) => u.accountId)).not.toContain("acc-2");
    expect(result.users.map((u) => u.displayName)).not.toContain("Bob");
  });

  it("returns empty array when all users are inactive", async () => {
    client.getAssignableUsers.mockResolvedValueOnce([
      makeUser({ active: false }),
    ]);

    const result = await getAssignableUsersTool.handler({}) as {
      users: AssignableUser[];
    };

    expect(result.users).toHaveLength(0);
  });

  it("returns empty array when Jira returns no users", async () => {
    client.getAssignableUsers.mockResolvedValueOnce([]);

    const result = await getAssignableUsersTool.handler({}) as {
      users: AssignableUser[];
    };

    expect(result.users).toHaveLength(0);
  });
});

describe("get_assignable_users — sort by displayName", () => {
  it("sorts active users by displayName ascending (locale compare)", async () => {
    client.getAssignableUsers.mockResolvedValueOnce([
      makeUser({ accountId: "acc-3", displayName: "Zara", active: true }),
      makeUser({ accountId: "acc-1", displayName: "Alice", active: true }),
      makeUser({ accountId: "acc-2", displayName: "Bob", active: true }),
    ]);

    const result = await getAssignableUsersTool.handler({}) as {
      users: AssignableUser[];
    };

    expect(result.users.map((u) => u.displayName)).toEqual(["Alice", "Bob", "Zara"]);
  });

  it("sort is applied AFTER inactive filter", async () => {
    client.getAssignableUsers.mockResolvedValueOnce([
      makeUser({ accountId: "acc-z", displayName: "Zara", active: true }),
      makeUser({ accountId: "acc-m", displayName: "Mike", active: false }),
      makeUser({ accountId: "acc-a", displayName: "Alice", active: true }),
    ]);

    const result = await getAssignableUsersTool.handler({}) as {
      users: AssignableUser[];
    };

    expect(result.users.map((u) => u.displayName)).toEqual(["Alice", "Zara"]);
  });
});

describe("get_assignable_users — maxResults passthrough", () => {
  it("passes maxResults to jiraClient.getAssignableUsers", async () => {
    client.getAssignableUsers.mockResolvedValueOnce([]);

    await getAssignableUsersTool.handler({ maxResults: 25 });

    expect(client.getAssignableUsers).toHaveBeenCalledWith(expect.any(String), 25);
  });

  it("defaults maxResults to 50 when not provided", async () => {
    client.getAssignableUsers.mockResolvedValueOnce([]);

    await getAssignableUsersTool.handler({});

    expect(client.getAssignableUsers).toHaveBeenCalledWith(expect.any(String), 50);
  });

  it("rejects maxResults < 1 (zod min(1))", async () => {
    await expect(
      getAssignableUsersTool.handler({ maxResults: 0 })
    ).rejects.toThrow();
  });
});

describe("get_assignable_users — output shape", () => {
  it("output has projectKey and users with AssignableUser shape", async () => {
    client.getAssignableUsers.mockResolvedValueOnce([
      makeUser({ accountId: "acc-1", displayName: "Alice", active: true }),
    ]);

    const result = await getAssignableUsersTool.handler({}) as {
      projectKey: string;
      users: AssignableUser[];
    };

    expect(typeof result.projectKey).toBe("string");
    expect(Array.isArray(result.users)).toBe(true);
    const u = result.users[0]!;
    expect(typeof u.accountId).toBe("string");
    expect(typeof u.displayName).toBe("string");
    expect(typeof u.active).toBe("boolean");
  });
});

// ========================================================================
// B. assign_issue
// ========================================================================

describe("assign_issue — happy path", () => {
  it("assigns with accountId string → assigned: true", async () => {
    client.assignIssue.mockResolvedValueOnce(undefined);

    const result = await assignIssueTool.handler({
      ticketKey: "DEV-42",
      accountId: "acc-abc",
    }) as { ticketKey: string; accountId: string | null; assigned: boolean };

    expect(result.ticketKey).toBe("DEV-42");
    expect(result.accountId).toBe("acc-abc");
    expect(result.assigned).toBe(true);
    expect(client.assignIssue).toHaveBeenCalledWith("DEV-42", "acc-abc");
  });

  it("unassigns with null → assigned: false", async () => {
    client.assignIssue.mockResolvedValueOnce(undefined);

    const result = await assignIssueTool.handler({
      ticketKey: "DEV-42",
      accountId: null,
    }) as { ticketKey: string; accountId: string | null; assigned: boolean };

    expect(result.ticketKey).toBe("DEV-42");
    expect(result.accountId).toBeNull();
    expect(result.assigned).toBe(false);
    expect(client.assignIssue).toHaveBeenCalledWith("DEV-42", null);
  });
});

describe("assign_issue — 404 maps to UPSTREAM", () => {
  it("throws UPSTREAM 'Ticket <key> not found' on 404", async () => {
    client.assignIssue.mockRejectedValueOnce(
      new UpstreamError("Ticket DEV-99 not found", 404)
    );

    await expect(
      assignIssueTool.handler({ ticketKey: "DEV-99", accountId: "acc-x" })
    ).rejects.toThrow("Ticket DEV-99 not found");
  });

  it("re-throws non-404 UpstreamError as-is", async () => {
    client.assignIssue.mockRejectedValueOnce(
      new UpstreamError("Jira authentication failed — check JIRA_EMAIL / JIRA_API_TOKEN", 401)
    );

    await expect(
      assignIssueTool.handler({ ticketKey: "DEV-1", accountId: "acc-x" })
    ).rejects.toThrow("Jira authentication failed");
  });
});

describe("assign_issue — validation (zod)", () => {
  it("rejects ticketKey with lowercase project (not matching regex)", async () => {
    await expect(
      assignIssueTool.handler({ ticketKey: "dev-42", accountId: "acc-x" })
    ).rejects.toThrow();
  });

  it("rejects ticketKey with no number part", async () => {
    await expect(
      assignIssueTool.handler({ ticketKey: "DEV", accountId: "acc-x" })
    ).rejects.toThrow();
  });

  it("rejects ticketKey with spaces", async () => {
    await expect(
      assignIssueTool.handler({ ticketKey: "DEV 42", accountId: "acc-x" })
    ).rejects.toThrow();
  });

  it("rejects empty accountId string (min length 1)", async () => {
    await expect(
      assignIssueTool.handler({ ticketKey: "DEV-42", accountId: "" })
    ).rejects.toThrow();
  });

  it("accepts null accountId (unassign)", async () => {
    client.assignIssue.mockResolvedValueOnce(undefined);
    const result = await assignIssueTool.handler({
      ticketKey: "DEV-1",
      accountId: null,
    }) as { assigned: boolean };
    expect(result.assigned).toBe(false);
  });

  it("rejects missing ticketKey", async () => {
    await expect(
      assignIssueTool.handler({ accountId: "acc-x" })
    ).rejects.toThrow();
  });
});

// ========================================================================
// C. Tool registry
// ========================================================================

describe("v1.7 tools in tool registry", () => {
  it("get_assignable_users is registered in tools/index.ts", async () => {
    const { tools } = await import("../src/tools/index.js");
    const names = tools.map((t) => t.name);
    expect(names).toContain("get_assignable_users");
  });

  it("assign_issue is registered in tools/index.ts", async () => {
    const { tools } = await import("../src/tools/index.js");
    const names = tools.map((t) => t.name);
    expect(names).toContain("assign_issue");
  });
});
