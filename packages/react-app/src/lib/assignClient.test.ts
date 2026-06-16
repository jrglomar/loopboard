// assignClient.test.ts — CONTRACTS.md §4.15 v1.7, ADR-018
// Tests: envelope unwrap, error propagation, BRIDGE_DOWN.
// Keyless/offline — mcpClient.callTool is mocked.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock mcpClient ────────────────────────────────────────────────────────────

vi.mock("./mcpClient", () => ({
  callTool: vi.fn(),
}));

import * as mcpClientModule from "./mcpClient";
import { getAssignableUsers, assignIssue } from "./assignClient";

// ── getAssignableUsers ────────────────────────────────────────────────────────

describe("getAssignableUsers — envelope unwrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns users array from tool envelope", async () => {
    vi.mocked(mcpClientModule.callTool).mockResolvedValueOnce({
      projectKey: "DEV",
      users: [
        { accountId: "acc-1", displayName: "Alice", active: true },
        { accountId: "acc-2", displayName: "Bob", active: true },
      ],
    });

    const result = await getAssignableUsers({ projectKey: "DEV" });

    expect(result).toEqual([
      { accountId: "acc-1", displayName: "Alice", active: true },
      { accountId: "acc-2", displayName: "Bob", active: true },
    ]);
  });

  it("calls callTool with get_assignable_users and opts", async () => {
    vi.mocked(mcpClientModule.callTool).mockResolvedValueOnce({
      projectKey: "DEV",
      users: [],
    });

    await getAssignableUsers({ projectKey: "DEV", boardId: 10 });

    expect(vi.mocked(mcpClientModule.callTool)).toHaveBeenCalledWith(
      "jira",
      "get_assignable_users",
      { projectKey: "DEV", boardId: 10 }
    );
  });

  it("returns empty array when users is empty", async () => {
    vi.mocked(mcpClientModule.callTool).mockResolvedValueOnce({
      projectKey: "DEV",
      users: [],
    });

    const result = await getAssignableUsers({ projectKey: "DEV" });
    expect(result).toEqual([]);
  });

  it("propagates McpError from callTool (e.g. BRIDGE_DOWN)", async () => {
    const bridgeError = {
      code: "BRIDGE_DOWN",
      message: "Cannot reach jira bridge — run: npm run dev:jira:http",
    };
    vi.mocked(mcpClientModule.callTool).mockRejectedValueOnce(bridgeError);

    await expect(getAssignableUsers({ projectKey: "DEV" })).rejects.toMatchObject({
      code: "BRIDGE_DOWN",
    });
  });

  it("propagates UPSTREAM errors", async () => {
    const upstreamError = { code: "UPSTREAM", message: "Project not found" };
    vi.mocked(mcpClientModule.callTool).mockRejectedValueOnce(upstreamError);

    await expect(getAssignableUsers({ projectKey: "MISSING" })).rejects.toMatchObject({
      code: "UPSTREAM",
    });
  });
});

// ── assignIssue ───────────────────────────────────────────────────────────────

describe("assignIssue — envelope unwrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns assign result on success", async () => {
    vi.mocked(mcpClientModule.callTool).mockResolvedValueOnce({
      ticketKey: "DEV-42",
      accountId: "acc-1",
      assigned: true,
    });

    const result = await assignIssue("DEV-42", "acc-1");

    expect(result).toEqual({
      ticketKey: "DEV-42",
      accountId: "acc-1",
      assigned: true,
    });
  });

  it("calls callTool with assign_issue, ticketKey, and accountId", async () => {
    vi.mocked(mcpClientModule.callTool).mockResolvedValueOnce({
      ticketKey: "DEV-42",
      accountId: "acc-1",
      assigned: true,
    });

    await assignIssue("DEV-42", "acc-1");

    expect(vi.mocked(mcpClientModule.callTool)).toHaveBeenCalledWith(
      "jira",
      "assign_issue",
      { ticketKey: "DEV-42", accountId: "acc-1" }
    );
  });

  it("passes null accountId to unassign", async () => {
    vi.mocked(mcpClientModule.callTool).mockResolvedValueOnce({
      ticketKey: "DEV-42",
      accountId: null,
      assigned: false,
    });

    const result = await assignIssue("DEV-42", null);

    expect(vi.mocked(mcpClientModule.callTool)).toHaveBeenCalledWith(
      "jira",
      "assign_issue",
      { ticketKey: "DEV-42", accountId: null }
    );
    expect(result.assigned).toBe(false);
    expect(result.accountId).toBeNull();
  });

  it("propagates McpError (BRIDGE_DOWN) from callTool", async () => {
    const bridgeError = {
      code: "BRIDGE_DOWN",
      message: "Cannot reach jira bridge",
    };
    vi.mocked(mcpClientModule.callTool).mockRejectedValueOnce(bridgeError);

    await expect(assignIssue("DEV-99", "acc-1")).rejects.toMatchObject({
      code: "BRIDGE_DOWN",
    });
  });

  it("propagates UPSTREAM 404 error (ticket not found)", async () => {
    const upstreamError = { code: "UPSTREAM", message: "Ticket DEV-99 not found" };
    vi.mocked(mcpClientModule.callTool).mockRejectedValueOnce(upstreamError);

    await expect(assignIssue("DEV-99", "acc-1")).rejects.toMatchObject({
      code: "UPSTREAM",
      message: expect.stringContaining("not found"),
    });
  });
});
