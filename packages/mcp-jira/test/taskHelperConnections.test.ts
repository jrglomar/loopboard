// Task Helper connections — v1.44, ADR-054. Boots the app; validators mocked (no network).
// Also asserts the security invariant: raw tokens never appear in responses OR on disk.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Server } from "http";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resetConfigCache } from "../src/lib/config.js";

vi.mock("../src/lib/userJira.js", () => ({
  makeUserJira: vi.fn(),
  validateJira: vi.fn(),
  fetchMySprintIssues: vi.fn(),
  fetchIssueDetail: vi.fn(),
}));
vi.mock("../src/lib/userGithub.js", () => ({ validateGithub: vi.fn() }));
vi.mock("../src/lib/userAi.js", () => ({ validateAi: vi.fn() }));

import { validateJira } from "../src/lib/userJira.js";
import { validateGithub } from "../src/lib/userGithub.js";
import { validateAi } from "../src/lib/userAi.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loopboard-conn-"));
const storeFile = path.join(dir, "users.json");

process.env["JIRA_BASE_URL"] = "https://test.atlassian.net";
process.env["JIRA_EMAIL"] = "t@example.com";
process.env["JIRA_API_TOKEN"] = "tok";
process.env["JIRA_PO_BOARD_ID"] = "10001";
process.env["JIRA_DEV_BOARD_ID"] = "10002";
process.env["TOKEN_ENC_KEY"] = Buffer.alloc(32, 9).toString("base64");
process.env["SESSION_SECRET"] = "conn-test-secret";
process.env["TASK_HELPER_FILE"] = storeFile;
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
  const text = await r.text();
  return { status: r.status, text, json: JSON.parse(text), cookie: session ?? null };
}

const JIRA_TOKEN = "super-secret-jira-token-ZZZ9";
const GH_TOKEN = "ghp_supersecrettoken1234";

describe("Task Helper connections (v1.44)", () => {
  let cookie: string;

  beforeAll(async () => {
    const s = await req("POST", "/api/auth/signup", { email: "conn@team.com", password: "password123" });
    cookie = s.cookie!;
  });

  it("starts with no connections", async () => {
    const r = await req("GET", "/api/me/connections", undefined, cookie);
    expect(r.json.data).toEqual({ jira: null, github: null, ai: null });
  });

  it("connects an AI token after validation (masked; no raw token)", async () => {
    vi.mocked(validateAi).mockResolvedValueOnce({ provider: "github", model: "openai/gpt-4o-mini" });
    const r = await req("PUT", "/api/me/connections/ai", { provider: "github", token: "ghp_ai_secret_9999" }, cookie);
    expect(r.status).toBe(200);
    expect(r.json.data.ai).toMatchObject({ connected: true, provider: "github", model: "openai/gpt-4o-mini", hint: "…9999" });
    expect(r.text).not.toContain("ghp_ai_secret_9999");
  });

  it("rejects an invalid AI token with 400 INVALID_CONNECTION", async () => {
    vi.mocked(validateAi).mockRejectedValueOnce(new Error("GitHub rejected the token (401: Bad credentials)"));
    const r = await req("PUT", "/api/me/connections/ai", { provider: "github", token: "bad" }, cookie);
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe("INVALID_CONNECTION");
  });

  it("/api/me/context reports readiness (needs Jira + GitHub)", async () => {
    const r = await req("GET", "/api/me/context", undefined, cookie);
    expect(r.status).toBe(200);
    expect(typeof r.json.data.ready).toBe("boolean");
    expect(r.json.data.connections).toHaveProperty("jira");
    expect(r.json.data.boards).toHaveProperty("dev");
  });

  it("401s without a cookie", async () => {
    const r = await req("GET", "/api/me/connections");
    expect(r.status).toBe(401);
  });

  it("connects Jira after validation, returning a MASKED status (no raw token)", async () => {
    vi.mocked(validateJira).mockResolvedValueOnce({ accountId: "acc-1", displayName: "Conn User" });
    const r = await req("PUT", "/api/me/connections/jira",
      { baseUrl: "https://team.atlassian.net", email: "conn@team.com", token: JIRA_TOKEN }, cookie);
    expect(r.status).toBe(200);
    expect(r.json.data.jira).toMatchObject({ connected: true, baseUrl: "https://team.atlassian.net", email: "conn@team.com", hint: "…ZZZ9" });
    expect(r.text).not.toContain(JIRA_TOKEN); // the raw token is NEVER returned
  });

  it("rejects invalid Jira credentials with 400 INVALID_CONNECTION", async () => {
    vi.mocked(validateJira).mockRejectedValueOnce(new Error("Jira rejected these credentials"));
    const r = await req("PUT", "/api/me/connections/jira",
      { baseUrl: "https://team.atlassian.net", email: "conn@team.com", token: "bad" }, cookie);
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe("INVALID_CONNECTION");
  });

  it("connects GitHub after validation", async () => {
    vi.mocked(validateGithub).mockResolvedValueOnce({ login: "conn-user" });
    const r = await req("PUT", "/api/me/connections/github", { token: GH_TOKEN }, cookie);
    expect(r.status).toBe(200);
    expect(r.json.data.github).toMatchObject({ connected: true, login: "conn-user", hint: "…1234" });
    expect(r.text).not.toContain(GH_TOKEN);
  });

  it("stores tokens ENCRYPTED on disk — no plaintext token in the store file", () => {
    const onDisk = fs.readFileSync(storeFile, "utf8");
    expect(onDisk).not.toContain(JIRA_TOKEN);
    expect(onDisk).not.toContain(GH_TOKEN);
    expect(onDisk).toContain("ciphertext"); // the sealed shape is present
  });

  it("disconnects a provider", async () => {
    const r = await req("DELETE", "/api/me/connections/jira", undefined, cookie);
    expect(r.status).toBe(200);
    expect(r.json.data.jira).toBeNull();
    expect(r.json.data.github).not.toBeNull(); // github still connected
  });
});
