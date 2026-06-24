// Ticket-action tools tests — v1.15, ADR-026. Keyless/offline (jiraClient mocked).

import { describe, it, expect, vi, beforeEach, type MockedObject } from "vitest";
import { resetConfigCache } from "../src/lib/config.js";

vi.mock("../src/lib/jiraClient.js", () => ({
  getTransitions: vi.fn(),
  transitionIssue: vi.fn(),
  addIssuesToSprint: vi.fn(),
}));

import * as jiraClient from "../src/lib/jiraClient.js";
import { getTransitionsTool } from "../src/tools/getTransitions.js";
import { transitionIssueTool } from "../src/tools/transitionIssue.js";
import { moveIssueToSprintTool } from "../src/tools/moveIssueToSprint.js";

const client = jiraClient as MockedObject<typeof jiraClient>;

function setEnv() {
  process.env["JIRA_BASE_URL"] = "https://test.atlassian.net";
  process.env["JIRA_EMAIL"] = "t@example.com";
  process.env["JIRA_API_TOKEN"] = "tok";
  process.env["JIRA_PO_BOARD_ID"] = "10001";
  process.env["JIRA_DEV_BOARD_ID"] = "10002";
  process.env["JIRA_PO_PROJECT_KEY"] = "PO";
  process.env["JIRA_DEV_PROJECT_KEY"] = "DEV";
}

beforeEach(() => {
  resetConfigCache();
  setEnv();
  vi.clearAllMocks();
});

describe("get_transitions (v1.15)", () => {
  it("returns the issue's available transitions", async () => {
    client.getTransitions.mockResolvedValueOnce([
      { id: "21", name: "Start", to: { name: "In Progress", category: "inprogress" } },
    ]);
    const result = (await getTransitionsTool.handler({ ticketKey: "DEV-1" })) as {
      ticketKey: string; transitions: Array<{ id: string; name: string }>;
    };
    expect(result.ticketKey).toBe("DEV-1");
    expect(result.transitions).toEqual([
      { id: "21", name: "Start", to: { name: "In Progress", category: "inprogress" } },
    ]);
    expect(client.getTransitions).toHaveBeenCalledWith("DEV-1");
  });

  it("rejects missing ticketKey", async () => {
    await expect(getTransitionsTool.handler({})).rejects.toThrow();
  });
});

describe("transition_issue (v1.15)", () => {
  it("applies the transition and returns the new status", async () => {
    client.transitionIssue.mockResolvedValueOnce({
      ticketKey: "DEV-1", status: "In Progress", statusCategory: "inprogress",
    });
    const result = (await transitionIssueTool.handler({ ticketKey: "DEV-1", transitionId: "21" })) as {
      status: string; statusCategory: string;
    };
    expect(result.status).toBe("In Progress");
    expect(result.statusCategory).toBe("inprogress");
    expect(client.transitionIssue).toHaveBeenCalledWith("DEV-1", "21");
  });

  it("rejects missing transitionId", async () => {
    await expect(transitionIssueTool.handler({ ticketKey: "DEV-1" })).rejects.toThrow();
  });
});

describe("move_issue_to_sprint (v1.15)", () => {
  it("moves the ticket by adding it to the target sprint", async () => {
    client.addIssuesToSprint.mockResolvedValueOnce(undefined);
    const result = (await moveIssueToSprintTool.handler({ ticketKey: "DEV-1", sprintId: 300 })) as {
      ticketKey: string; sprintId: number;
    };
    expect(result).toEqual({ ticketKey: "DEV-1", sprintId: 300 });
    expect(client.addIssuesToSprint).toHaveBeenCalledWith(300, ["DEV-1"]);
  });

  it("rejects a non-positive sprintId", async () => {
    await expect(moveIssueToSprintTool.handler({ ticketKey: "DEV-1", sprintId: 0 })).rejects.toThrow();
  });
});
