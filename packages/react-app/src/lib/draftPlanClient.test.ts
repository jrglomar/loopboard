// draftPlanClient tests — CONTRACTS.md §4.30 v1.70, ADR-081
// Keyless/offline — mcpClient.callTool is mocked.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock mcpClient ────────────────────────────────────────────────────────────

vi.mock("./mcpClient", () => ({
  callTool: vi.fn(),
}));

import * as mcpClientModule from "./mcpClient";
import { getDraftPlan, setDraftPlan } from "./draftPlanClient";
import type { DraftShare, DraftPlan } from "./types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ASSIGNMENTS: Record<string, DraftShare[]> = {
  "PO-1": [{ accountId: "acc-1", displayName: "Alice", points: 5 }],
  "PO-2": [
    { accountId: "acc-2", displayName: "Bob", points: 2 },
    { accountId: "acc-1", displayName: "Alice", points: 1 },
  ],
};

const DRAFT_PLAN: DraftPlan = {
  sprintId: 100,
  devSprintId: 200,
  assignments: ASSIGNMENTS,
};

const EMPTY_DRAFT_PLAN: DraftPlan = {
  sprintId: 100,
  devSprintId: null,
  assignments: {},
};

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ── getDraftPlan ──────────────────────────────────────────────────────────────

describe("getDraftPlan", () => {
  it("calls get_draft_plan with { sprintId } and returns the draft", async () => {
    vi.mocked(mcpClientModule.callTool).mockResolvedValueOnce(DRAFT_PLAN);

    const result = await getDraftPlan(100);
    expect(result).toEqual(DRAFT_PLAN);
    expect(vi.mocked(mcpClientModule.callTool)).toHaveBeenCalledWith(
      "jira",
      "get_draft_plan",
      { sprintId: 100 }
    );
  });

  it("returns the empty-draft shape when no draft has been saved", async () => {
    vi.mocked(mcpClientModule.callTool).mockResolvedValueOnce(EMPTY_DRAFT_PLAN);

    const result = await getDraftPlan(100);
    expect(result).toEqual({ sprintId: 100, devSprintId: null, assignments: {} });
  });

  it("returns a multi-share array for a split ticket", async () => {
    vi.mocked(mcpClientModule.callTool).mockResolvedValueOnce(DRAFT_PLAN);

    const result = await getDraftPlan(100);
    expect(result.assignments["PO-2"]).toHaveLength(2);
    expect(result.assignments["PO-2"]).toEqual([
      { accountId: "acc-2", displayName: "Bob", points: 2 },
      { accountId: "acc-1", displayName: "Alice", points: 1 },
    ]);
  });

  it("throws McpError on bridge error", async () => {
    const error = { code: "BRIDGE_DOWN", message: "Cannot reach jira bridge" };
    vi.mocked(mcpClientModule.callTool).mockRejectedValueOnce(error);

    await expect(getDraftPlan(100)).rejects.toMatchObject({ code: "BRIDGE_DOWN" });
  });
});

// ── setDraftPlan ──────────────────────────────────────────────────────────────

describe("setDraftPlan — full-replace semantics", () => {
  it("calls set_draft_plan with sprintId, devSprintId, and the share-array assignments", async () => {
    vi.mocked(mcpClientModule.callTool).mockResolvedValueOnce(DRAFT_PLAN);

    const result = await setDraftPlan(100, 200, ASSIGNMENTS);
    expect(result).toEqual(DRAFT_PLAN);
    expect(vi.mocked(mcpClientModule.callTool)).toHaveBeenCalledWith(
      "jira",
      "set_draft_plan",
      { sprintId: 100, devSprintId: 200, assignments: ASSIGNMENTS }
    );
  });

  it("sends devSprintId: null explicitly when clearing the dev sprint pairing", async () => {
    vi.mocked(mcpClientModule.callTool).mockResolvedValueOnce(EMPTY_DRAFT_PLAN);

    await setDraftPlan(100, null, {});
    expect(vi.mocked(mcpClientModule.callTool)).toHaveBeenCalledWith(
      "jira",
      "set_draft_plan",
      { sprintId: 100, devSprintId: null, assignments: {} }
    );
  });

  it("sends an empty assignments map to clear the draft (deletes the entry server-side)", async () => {
    vi.mocked(mcpClientModule.callTool).mockResolvedValueOnce(EMPTY_DRAFT_PLAN);

    const result = await setDraftPlan(100, null, {});
    expect(result).toEqual(EMPTY_DRAFT_PLAN);
  });

  it("throws McpError on upstream error", async () => {
    const error = { code: "VALIDATION", message: "invalid issue key" };
    vi.mocked(mcpClientModule.callTool).mockRejectedValueOnce(error);

    await expect(setDraftPlan(100, 200, ASSIGNMENTS)).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });
});
