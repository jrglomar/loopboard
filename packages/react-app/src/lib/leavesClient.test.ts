// leavesClient.ts unit tests — ADR-016, v1.5
// Mocks mcpClient.callTool; no network required. Keyless/offline.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { getLeaves, setLeaves } from "./leavesClient";

// ── Mock mcpClient ────────────────────────────────────────────────────────────

vi.mock("./mcpClient", () => ({
  callTool: vi.fn(),
}));

import { callTool } from "./mcpClient";
const mockCallTool = vi.mocked(callTool);

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SPRINT_ID = 42;
const LEAVES_MAP = {
  Alice: { "2026-06-01": "VL", "2026-06-02": "VL" },
  Bob: { "2026-06-03": "VL" },
};

const GET_LEAVES_RESPONSE = { sprintId: SPRINT_ID, leaves: LEAVES_MAP };
const SET_LEAVES_RESPONSE = {
  sprintId: SPRINT_ID,
  leaves: { ...LEAVES_MAP, Carol: { "2026-06-04": "Offset" } },
};

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ── getLeaves ─────────────────────────────────────────────────────────────────

describe("getLeaves", () => {
  it("calls callTool with jira / get_leaves / { sprintId }", async () => {
    mockCallTool.mockResolvedValueOnce(GET_LEAVES_RESPONSE);
    await getLeaves(SPRINT_ID);
    expect(mockCallTool).toHaveBeenCalledOnce();
    expect(mockCallTool).toHaveBeenCalledWith("jira", "get_leaves", { sprintId: SPRINT_ID });
  });

  it("returns the leaves map from the response envelope", async () => {
    mockCallTool.mockResolvedValueOnce(GET_LEAVES_RESPONSE);
    const result = await getLeaves(SPRINT_ID);
    expect(result).toEqual(LEAVES_MAP);
  });

  it("returns {} when the response has an empty leaves object", async () => {
    mockCallTool.mockResolvedValueOnce({ sprintId: SPRINT_ID, leaves: {} });
    const result = await getLeaves(SPRINT_ID);
    expect(result).toEqual({});
  });

  it("propagates McpError (BRIDGE_DOWN) when callTool throws", async () => {
    const bridgeError = { code: "BRIDGE_DOWN", message: "Cannot reach jira bridge — run: npm run dev:jira:http" };
    mockCallTool.mockRejectedValueOnce(bridgeError);
    await expect(getLeaves(SPRINT_ID)).rejects.toMatchObject({ code: "BRIDGE_DOWN" });
  });

  it("propagates McpError (UPSTREAM) when callTool throws", async () => {
    const upstreamError = { code: "UPSTREAM", message: "Jira API error" };
    mockCallTool.mockRejectedValueOnce(upstreamError);
    await expect(getLeaves(SPRINT_ID)).rejects.toMatchObject({ code: "UPSTREAM" });
  });
});

// ── setLeaves ─────────────────────────────────────────────────────────────────

describe("setLeaves", () => {
  it("calls callTool with jira / set_leaves / { sprintId, assignee, entries }", async () => {
    mockCallTool.mockResolvedValueOnce(SET_LEAVES_RESPONSE);
    await setLeaves(SPRINT_ID, "Carol", [{ date: "2026-06-04", type: "Offset" }]);
    expect(mockCallTool).toHaveBeenCalledOnce();
    expect(mockCallTool).toHaveBeenCalledWith("jira", "set_leaves", {
      sprintId: SPRINT_ID,
      assignee: "Carol",
      entries: [{ date: "2026-06-04", type: "Offset" }],
    });
  });

  it("returns the updated leaves map from the response envelope", async () => {
    mockCallTool.mockResolvedValueOnce(SET_LEAVES_RESPONSE);
    const result = await setLeaves(SPRINT_ID, "Carol", [{ date: "2026-06-04", type: "Offset" }]);
    expect(result).toEqual(SET_LEAVES_RESPONSE.leaves);
  });

  it("clears an assignee's leaves when entries is empty", async () => {
    const clearedResponse = {
      sprintId: SPRINT_ID,
      leaves: { Alice: { "2026-06-01": "VL", "2026-06-02": "VL" } }, // Bob removed
    };
    mockCallTool.mockResolvedValueOnce(clearedResponse);
    const result = await setLeaves(SPRINT_ID, "Bob", []);
    expect(result).toEqual(clearedResponse.leaves);
    expect(mockCallTool).toHaveBeenCalledWith("jira", "set_leaves", {
      sprintId: SPRINT_ID,
      assignee: "Bob",
      entries: [],
    });
  });

  it("propagates McpError (BRIDGE_DOWN) when callTool throws", async () => {
    const bridgeError = {
      code: "BRIDGE_DOWN",
      message: "Cannot reach jira bridge — run: npm run dev:jira:http",
    };
    mockCallTool.mockRejectedValueOnce(bridgeError);
    await expect(setLeaves(SPRINT_ID, "Alice", [{ date: "2026-06-01", type: "VL" }])).rejects.toMatchObject({
      code: "BRIDGE_DOWN",
    });
  });

  it("propagates validation error from callTool", async () => {
    const validationError = {
      code: "VALIDATION",
      message: "Invalid date format",
      issues: [{ message: "entries[0].date: Expected YYYY-MM-DD" }],
    };
    mockCallTool.mockRejectedValueOnce(validationError);
    await expect(setLeaves(SPRINT_ID, "Alice", [{ date: "not-a-date" as string, type: "VL" }])).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });
});
