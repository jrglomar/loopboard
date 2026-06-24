// get_issue_descriptions tool tests — v1.14, ADR-025. Keyless/offline (jiraClient mocked).

import { describe, it, expect, vi, beforeEach, type MockedObject } from "vitest";
import { resetConfigCache } from "../src/lib/config.js";

vi.mock("../src/lib/jiraClient.js", () => ({
  getIssue: vi.fn(),
}));

import * as jiraClient from "../src/lib/jiraClient.js";
import { getIssueDescriptionsTool } from "../src/tools/getIssueDescriptions.js";

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

// Minimal getIssue stub — only the fields the tool reads matter.
const mkIssue = (key: string, description: string) =>
  ({ key, description, summary: `${key} summary` }) as Awaited<ReturnType<typeof jiraClient.getIssue>>;

describe("get_issue_descriptions (v1.14)", () => {
  it("returns each key's flattened description", async () => {
    client.getIssue.mockImplementation(async (key: string) =>
      mkIssue(key, key === "PO-1" ? "As a user I want X" : "Scope: Y")
    );

    const result = (await getIssueDescriptionsTool.handler({ keys: ["PO-1", "PO-2"] })) as {
      descriptions: Record<string, string>;
    };

    expect(Object.keys(result.descriptions).sort()).toEqual(["PO-1", "PO-2"]);
    expect(result.descriptions["PO-1"]).toBe("As a user I want X");
    expect(result.descriptions["PO-2"]).toBe("Scope: Y");
  });

  it("a missing/unreadable key contributes '' (non-fatal for the batch)", async () => {
    client.getIssue.mockImplementation(async (key: string) => {
      if (key === "PO-2") throw new Error("404 not found");
      return mkIssue(key, "real description");
    });

    const result = (await getIssueDescriptionsTool.handler({ keys: ["PO-1", "PO-2"] })) as {
      descriptions: Record<string, string>;
    };

    expect(result.descriptions["PO-1"]).toBe("real description");
    expect(result.descriptions["PO-2"]).toBe(""); // error swallowed, key still present
  });

  it("rejects empty input (schema: keys 1..50)", async () => {
    await expect(getIssueDescriptionsTool.handler({ keys: [] })).rejects.toThrow();
  });
});
