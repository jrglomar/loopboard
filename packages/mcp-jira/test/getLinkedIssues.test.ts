// get_linked_issues tool tests — v1.11, ADR-022. Keyless/offline (jiraClient mocked).

import { describe, it, expect, vi, beforeEach, type MockedObject } from "vitest";
import { resetConfigCache } from "../src/lib/config.js";

vi.mock("../src/lib/jiraClient.js", () => ({
  getLinkedIssues: vi.fn(),
}));

import * as jiraClient from "../src/lib/jiraClient.js";
import { getLinkedIssuesTool } from "../src/tools/getLinkedIssues.js";

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

const DEV9 = { key: "DEV-9", summary: "Build it", status: "To Do", url: "u/DEV-9" };
const OTHER3 = { key: "OTHER-3", summary: "Unrelated", status: "Done", url: "u/OTHER-3" };

describe("get_linked_issues (v1.11)", () => {
  it("filters linked issues to the Dev project by default", async () => {
    client.getLinkedIssues.mockResolvedValueOnce([DEV9, OTHER3]);

    const result = (await getLinkedIssuesTool.handler({ keys: ["PO-1"] })) as {
      links: Record<string, Array<{ key: string }>>;
    };

    expect(result.links["PO-1"]!.map((l) => l.key)).toEqual(["DEV-9"]); // OTHER-3 filtered out
  });

  it("projectKey='' returns links to any project", async () => {
    client.getLinkedIssues.mockResolvedValueOnce([DEV9, OTHER3]);

    const result = (await getLinkedIssuesTool.handler({ keys: ["PO-1"], projectKey: "" })) as {
      links: Record<string, Array<{ key: string }>>;
    };

    expect(result.links["PO-1"]!.map((l) => l.key)).toEqual(["DEV-9", "OTHER-3"]);
  });

  it("returns an entry for every input key ([] when no Dev link)", async () => {
    client.getLinkedIssues.mockImplementation(async (key: string) =>
      key === "PO-1" ? [DEV9] : []
    );

    const result = (await getLinkedIssuesTool.handler({ keys: ["PO-1", "PO-2"] })) as {
      links: Record<string, Array<{ key: string }>>;
    };

    expect(Object.keys(result.links).sort()).toEqual(["PO-1", "PO-2"]);
    expect(result.links["PO-1"]).toHaveLength(1);
    expect(result.links["PO-2"]).toEqual([]);
  });

  it("respects an explicit projectKey filter", async () => {
    client.getLinkedIssues.mockResolvedValueOnce([DEV9, OTHER3]);

    const result = (await getLinkedIssuesTool.handler({
      keys: ["PO-1"],
      projectKey: "OTHER",
    })) as { links: Record<string, Array<{ key: string }>> };

    expect(result.links["PO-1"]!.map((l) => l.key)).toEqual(["OTHER-3"]);
  });
});
