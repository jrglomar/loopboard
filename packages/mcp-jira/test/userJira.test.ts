// userJira / userGithub validators + reads — v1.44, ADR-054. Mocked axios + fetch.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockGet, mockCreate } = vi.hoisted(() => {
  const mockGet = vi.fn();
  return { mockGet, mockCreate: vi.fn((_opts: unknown) => ({ get: mockGet })) };
});
vi.mock("axios", () => ({ default: { create: mockCreate } }));

import { validateJira, fetchMySprintIssues, fetchIssueDetail, makeUserJira } from "../src/lib/userJira.js";
import { validateGithub } from "../src/lib/userGithub.js";

const CREDS = { baseUrl: "https://team.atlassian.net/", email: "u@team.com", token: "tok-123" };

beforeEach(() => { mockGet.mockReset(); mockCreate.mockClear(); });
afterEach(() => vi.restoreAllMocks());

describe("userJira", () => {
  it("makeUserJira builds a client with a trimmed baseURL + Basic auth", () => {
    makeUserJira(CREDS);
    const opts = mockCreate.mock.calls[0]![0] as unknown as { baseURL: string; headers: Record<string, string> };
    expect(opts.baseURL).toBe("https://team.atlassian.net"); // trailing slash trimmed
    expect(opts.headers.Authorization).toMatch(/^Basic /);
  });

  it("validateJira returns the identity from /myself", async () => {
    mockGet.mockResolvedValueOnce({ data: { accountId: "acc-9", displayName: "Ada" } });
    expect(await validateJira(CREDS)).toEqual({ accountId: "acc-9", displayName: "Ada" });
    expect(mockGet).toHaveBeenCalledWith("/rest/api/3/myself");
  });

  it("validateJira maps a 401 to a friendly, token-free error", async () => {
    mockGet.mockRejectedValueOnce({ isAxiosError: true, response: { status: 401 } });
    await expect(validateJira(CREDS)).rejects.toThrow(/rejected these credentials/i);
  });

  it("fetchMySprintIssues uses the currentUser()/openSprints JQL and maps rows", async () => {
    mockGet.mockResolvedValueOnce({
      data: { issues: [{ key: "DEV-1", fields: { summary: "Fix bug", status: { name: "In Progress" } } }] },
    });
    const issues = await fetchMySprintIssues(CREDS);
    expect(issues).toEqual([
      { key: "DEV-1", summary: "Fix bug", status: "In Progress", url: "https://team.atlassian.net/browse/DEV-1" },
    ]);
    // v1.44.1: must use the NEW /search/jql endpoint (the classic /search is 410 Gone).
    expect(mockGet.mock.calls[0]![0]).toBe("/rest/api/3/search/jql");
    const params = (mockGet.mock.calls[0]![1] as { params: { jql: string } }).params;
    expect(params.jql).toContain("assignee = currentUser()");
    expect(params.jql).toContain("openSprints()");
  });

  it("fetchMySprintIssues scopes the JQL to a given sprintId (v1.46, Phase F)", async () => {
    mockGet.mockResolvedValueOnce({ data: { issues: [] } });
    await fetchMySprintIssues(CREDS, 4321);
    const params = (mockGet.mock.calls[0]![1] as { params: { jql: string } }).params;
    expect(params.jql).toContain("assignee = currentUser()");
    expect(params.jql).toContain("sprint = 4321");
    expect(params.jql).not.toContain("openSprints()"); // scoped, not all open sprints
  });

  it("fetchIssueDetail flattens the ADF description to plain text", async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        key: "DEV-2",
        fields: {
          summary: "Add endpoint",
          issuetype: { name: "Task" },
          status: { name: "To Do" },
          description: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Do the thing" }] }] },
        },
      },
    });
    const d = await fetchIssueDetail(CREDS, "DEV-2");
    expect(d.summary).toBe("Add endpoint");
    expect(d.description).toContain("Do the thing");
    expect(d.issueType).toBe("Task");
  });
});

describe("userGithub", () => {
  it("validateGithub returns the login on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ login: "octocat" }),
    }));
    expect(await validateGithub("ghp_x")).toEqual({ login: "octocat" });
  });

  it("validateGithub throws a friendly error on 401", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));
    await expect(validateGithub("bad")).rejects.toThrow(/rejected this token/i);
  });
});
