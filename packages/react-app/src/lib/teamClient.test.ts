// teamClient tests — CONTRACTS.md §4.16 v1.8, ADR-019
// Keyless/offline — mcpClient.callTool is mocked.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock mcpClient ────────────────────────────────────────────────────────────

vi.mock("./mcpClient", () => ({
  callTool: vi.fn(),
}));

import * as mcpClientModule from "./mcpClient";
import { getTeamMembers, setTeamMembers, getRecentAssignees } from "./teamClient";
import type { TeamMember, RecentAssignee } from "./types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MEMBERS: TeamMember[] = [
  { accountId: "acc-1", displayName: "Alice" },
  { accountId: "acc-2", displayName: "Bob" },
];

const RECENT: RecentAssignee[] = [
  { accountId: "acc-1", displayName: "Alice", ticketCount: 8 },
  { accountId: "acc-3", displayName: "Carol", ticketCount: 3 },
];

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ── getTeamMembers ────────────────────────────────────────────────────────────

describe("getTeamMembers — envelope unwrap", () => {
  it("calls get_team_members and returns members array", async () => {
    vi.mocked(mcpClientModule.callTool).mockResolvedValueOnce({
      boardId: 10,
      members: MEMBERS,
    });

    const result = await getTeamMembers(10);
    expect(result).toEqual(MEMBERS);
    expect(vi.mocked(mcpClientModule.callTool)).toHaveBeenCalledWith(
      "jira",
      "get_team_members",
      { boardId: 10 }
    );
  });

  it("passes empty input when boardId is undefined", async () => {
    vi.mocked(mcpClientModule.callTool).mockResolvedValueOnce({
      boardId: 10,
      members: [],
    });

    const result = await getTeamMembers(undefined);
    expect(result).toEqual([]);
    expect(vi.mocked(mcpClientModule.callTool)).toHaveBeenCalledWith(
      "jira",
      "get_team_members",
      {}
    );
  });

  it("throws McpError on bridge error", async () => {
    const error = { code: "BRIDGE_DOWN", message: "Cannot reach jira bridge" };
    vi.mocked(mcpClientModule.callTool).mockRejectedValueOnce(error);

    await expect(getTeamMembers(10)).rejects.toMatchObject({
      code: "BRIDGE_DOWN",
    });
  });
});

// ── setTeamMembers ────────────────────────────────────────────────────────────

describe("setTeamMembers — full-replace semantics", () => {
  it("calls set_team_members and returns updated members array", async () => {
    vi.mocked(mcpClientModule.callTool).mockResolvedValueOnce({
      boardId: 10,
      members: MEMBERS,
    });

    const result = await setTeamMembers(10, MEMBERS);
    expect(result).toEqual(MEMBERS);
    expect(vi.mocked(mcpClientModule.callTool)).toHaveBeenCalledWith(
      "jira",
      "set_team_members",
      { boardId: 10, members: MEMBERS }
    );
  });

  it("sends empty array to clear the roster", async () => {
    vi.mocked(mcpClientModule.callTool).mockResolvedValueOnce({
      boardId: 10,
      members: [],
    });

    const result = await setTeamMembers(10, []);
    expect(result).toEqual([]);
    expect(vi.mocked(mcpClientModule.callTool)).toHaveBeenCalledWith(
      "jira",
      "set_team_members",
      { boardId: 10, members: [] }
    );
  });

  it("omits boardId from input when boardId is undefined", async () => {
    vi.mocked(mcpClientModule.callTool).mockResolvedValueOnce({
      boardId: 10,
      members: MEMBERS,
    });

    await setTeamMembers(undefined, MEMBERS);
    expect(vi.mocked(mcpClientModule.callTool)).toHaveBeenCalledWith(
      "jira",
      "set_team_members",
      { members: MEMBERS }
    );
  });

  it("throws McpError on upstream error", async () => {
    const error = { code: "UPSTREAM", message: "Jira error" };
    vi.mocked(mcpClientModule.callTool).mockRejectedValueOnce(error);

    await expect(setTeamMembers(10, MEMBERS)).rejects.toMatchObject({
      code: "UPSTREAM",
    });
  });
});

// ── getRecentAssignees ────────────────────────────────────────────────────────

describe("getRecentAssignees — suggestion source", () => {
  it("calls get_recent_assignees and returns assignees array", async () => {
    vi.mocked(mcpClientModule.callTool).mockResolvedValueOnce({
      boardId: 10,
      assignees: RECENT,
    });

    const result = await getRecentAssignees(10);
    expect(result).toEqual(RECENT);
    expect(vi.mocked(mcpClientModule.callTool)).toHaveBeenCalledWith(
      "jira",
      "get_recent_assignees",
      { boardId: 10 }
    );
  });

  it("passes withinDays when provided (v1.9 — board-wide window)", async () => {
    vi.mocked(mcpClientModule.callTool).mockResolvedValueOnce({
      boardId: 10,
      assignees: RECENT,
    });

    await getRecentAssignees(10, 30);
    expect(vi.mocked(mcpClientModule.callTool)).toHaveBeenCalledWith(
      "jira",
      "get_recent_assignees",
      { boardId: 10, withinDays: 30 }
    );
  });

  it("returns [] for a board with no recent assignees", async () => {
    vi.mocked(mcpClientModule.callTool).mockResolvedValueOnce({
      boardId: 10,
      assignees: [],
    });

    const result = await getRecentAssignees(10);
    expect(result).toEqual([]);
  });

  it("throws McpError on error", async () => {
    vi.mocked(mcpClientModule.callTool).mockRejectedValueOnce({
      code: "BRIDGE_DOWN",
      message: "Cannot reach jira bridge",
    });

    await expect(getRecentAssignees(10)).rejects.toMatchObject({
      code: "BRIDGE_DOWN",
    });
  });
});
