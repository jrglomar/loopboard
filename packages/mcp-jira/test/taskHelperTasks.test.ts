// Task Helper tasks (fetch issues + AI help) — v1.44, ADR-054. Boots the app; Jira reads,
// the AI provider, and the pipeline are all mocked (keyless/offline).

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Server } from "http";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resetConfigCache } from "../src/lib/config.js";

vi.mock("../src/lib/userJira.js", () => ({
  makeUserJira: vi.fn(),
  validateJira: vi.fn().mockResolvedValue({ accountId: "acc", displayName: "Dev" }),
  fetchMySprintIssues: vi.fn(),
  fetchIssueDetail: vi.fn(),
}));
vi.mock("../src/lib/userGithub.js", () => ({ validateGithub: vi.fn() }));
vi.mock("../src/lib/ai/provider.js", async (orig) => {
  const actual = await orig<typeof import("../src/lib/ai/provider.js")>();
  return { ...actual, getAiProvider: vi.fn() };
});
vi.mock("../src/lib/ai/taskHelperService.js", () => ({ runTaskHelper: vi.fn() }));

import { fetchMySprintIssues, fetchIssueDetail } from "../src/lib/userJira.js";
import { getAiProvider } from "../src/lib/ai/provider.js";
import { runTaskHelper } from "../src/lib/ai/taskHelperService.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loopboard-tasks-"));
process.env["JIRA_BASE_URL"] = "https://test.atlassian.net";
process.env["JIRA_EMAIL"] = "t@example.com";
process.env["JIRA_API_TOKEN"] = "tok";
process.env["JIRA_PO_BOARD_ID"] = "10001";
process.env["JIRA_DEV_BOARD_ID"] = "10002";
process.env["TOKEN_ENC_KEY"] = Buffer.alloc(32, 3).toString("base64");
process.env["SESSION_SECRET"] = "tasks-secret";
process.env["TASK_HELPER_FILE"] = path.join(dir, "users.json");
process.env["VITEST"] = "true";
resetConfigCache();

const { app } = await import("../src/http.js");

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
      resolve();
    });
  });
});
afterAll(() => {
  server?.close();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

async function req(method: string, p: string, body?: unknown, cookie?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers["Cookie"] = cookie;
  const r = await fetch(`${baseUrl}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const h = r.headers as unknown as { getSetCookie?: () => string[] };
  const cookies = h.getSetCookie ? h.getSetCookie() : [r.headers.get("set-cookie") ?? ""];
  const session = cookies.map((c) => c.split(";")[0]).find((c) => c.startsWith("lb_session="));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: r.status, json: (await r.json()) as any, cookie: session ?? null };
}

const fakeProvider = { name: "anthropic", model: "m", complete: vi.fn(), chatWithTools: vi.fn() };

describe("Task Helper tasks (v1.44)", () => {
  let cookie: string;

  beforeAll(async () => {
    const s = await req("POST", "/api/auth/signup", { email: "tasks@team.com", password: "password123" });
    cookie = s.cookie!;
  });

  it("409s on fetch-issues before a Jira connection exists", async () => {
    const r = await req("GET", "/api/me/tasks/issues", undefined, cookie);
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("NO_JIRA_CONNECTION");
  });

  it("lists my sprint issues once Jira is connected", async () => {
    await req("PUT", "/api/me/connections/jira",
      { baseUrl: "https://team.atlassian.net", email: "tasks@team.com", token: "jira-token-abcd" }, cookie);
    vi.mocked(fetchMySprintIssues).mockResolvedValueOnce([
      { key: "DEV-1", summary: "Fix login", status: "In Progress", url: "https://team.atlassian.net/browse/DEV-1" },
    ]);
    const r = await req("GET", "/api/me/tasks/issues", undefined, cookie);
    expect(r.status).toBe(200);
    expect(r.json.data.issues[0].key).toBe("DEV-1");
    // the decrypted creds were passed to the fetcher
    expect(vi.mocked(fetchMySprintIssues).mock.calls[0]![0]).toMatchObject({ email: "tasks@team.com", token: "jira-token-abcd" });
  });

  it("runs the AI pipeline and returns { refinedText, prompt }", async () => {
    vi.mocked(fetchIssueDetail).mockResolvedValueOnce({
      key: "DEV-1", summary: "Fix login", description: "Users can't log in", status: "To Do", issueType: "Bug",
      url: "https://team.atlassian.net/browse/DEV-1",
    });
    vi.mocked(getAiProvider).mockResolvedValueOnce(fakeProvider as never);
    vi.mocked(runTaskHelper).mockResolvedValueOnce({ refinedText: "REFINED SPEC", prompt: "AGENT PROMPT" });

    const r = await req("POST", "/api/me/tasks/help", { ticketKey: "DEV-1" }, cookie);
    expect(r.status).toBe(200);
    expect(r.json.data).toEqual({ refinedText: "REFINED SPEC", prompt: "AGENT PROMPT" });
  });

  it("503s when AI is disabled", async () => {
    vi.mocked(getAiProvider).mockResolvedValueOnce(null);
    const r = await req("POST", "/api/me/tasks/help", { ticketKey: "DEV-1" }, cookie);
    expect(r.status).toBe(503);
    expect(r.json.error.code).toBe("AI_UNAVAILABLE");
  });

  it("validates the ticketKey format", async () => {
    const r = await req("POST", "/api/me/tasks/help", { ticketKey: "not a key" }, cookie);
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe("VALIDATION");
  });
});
