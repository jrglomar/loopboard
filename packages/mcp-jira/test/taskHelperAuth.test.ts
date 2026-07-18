// Task Helper auth endpoints — v1.44, ADR-054. Boots the express app + global fetch.

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import type { Server } from "http";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resetConfigCache } from "../src/lib/config.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "invokeboard-users-"));

process.env["JIRA_BASE_URL"] = "https://test.atlassian.net";
process.env["JIRA_EMAIL"] = "t@example.com";
process.env["JIRA_API_TOKEN"] = "tok";
process.env["JIRA_PO_BOARD_ID"] = "10001";
process.env["JIRA_DEV_BOARD_ID"] = "10002";
process.env["TOKEN_ENC_KEY"] = Buffer.alloc(32, 7).toString("base64");
process.env["SESSION_SECRET"] = "test-session-secret";
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
      const port = typeof addr === "object" && addr ? addr.port : 0;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(() => {
  server?.close();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

afterEach(() => {
  // keep secrets configured by default; restore after the 503 test toggles them
  process.env["TOKEN_ENC_KEY"] = Buffer.alloc(32, 7).toString("base64");
  process.env["SESSION_SECRET"] = "test-session-secret";
  resetConfigCache();
});

interface Res { status: number; json: any; cookie: string | null }

async function req(method: string, pathname: string, body?: unknown, cookie?: string): Promise<Res> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers["Cookie"] = cookie;
  const r = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const h = r.headers as unknown as { getSetCookie?: () => string[] };
  const setCookies = h.getSetCookie ? h.getSetCookie() : [r.headers.get("set-cookie") ?? ""];
  const sessionCookie = setCookies
    .map((c) => c.split(";")[0])
    .find((c) => c.startsWith("ib_session="));
  return { status: r.status, json: await r.json(), cookie: sessionCookie ?? null };
}

describe("Task Helper auth (v1.44)", () => {
  it("signup sets a session cookie and returns the email", async () => {
    const r = await req("POST", "/api/auth/signup", { email: "alice@team.com", password: "password123" });
    expect(r.status).toBe(200);
    expect(r.json.data.email).toBe("alice@team.com");
    expect(r.cookie).toMatch(/^ib_session=/);
  });

  it("the session cookie authenticates /api/auth/me", async () => {
    const s = await req("POST", "/api/auth/signup", { email: "bob@team.com", password: "password123" });
    const me = await req("GET", "/api/auth/me", undefined, s.cookie!);
    expect(me.status).toBe(200);
    expect(me.json.data.email).toBe("bob@team.com");
  });

  it("/api/auth/me is 401 without a cookie", async () => {
    const me = await req("GET", "/api/auth/me");
    expect(me.status).toBe(401);
    expect(me.json.error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects a duplicate email with 409", async () => {
    await req("POST", "/api/auth/signup", { email: "carol@team.com", password: "password123" });
    const dup = await req("POST", "/api/auth/signup", { email: "carol@team.com", password: "password123" });
    expect(dup.status).toBe(409);
    expect(dup.json.error.code).toBe("EMAIL_TAKEN");
  });

  it("login works with the right password and 401s on the wrong one", async () => {
    await req("POST", "/api/auth/signup", { email: "dave@team.com", password: "password123" });
    const ok = await req("POST", "/api/auth/login", { email: "dave@team.com", password: "password123" });
    expect(ok.status).toBe(200);
    expect(ok.cookie).toMatch(/^ib_session=/);

    const bad = await req("POST", "/api/auth/login", { email: "dave@team.com", password: "wrongpass!" });
    expect(bad.status).toBe(401);
    expect(bad.json.error.code).toBe("BAD_CREDENTIALS");
  });

  it("rejects a short password at signup (validation)", async () => {
    const r = await req("POST", "/api/auth/signup", { email: "eve@team.com", password: "short" });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe("VALIDATION");
  });

  it("returns 503 TASK_HELPER_UNAVAILABLE when the secrets are not configured", async () => {
    delete process.env["TOKEN_ENC_KEY"];
    delete process.env["SESSION_SECRET"];
    resetConfigCache();
    const r = await req("POST", "/api/auth/login", { email: "x@team.com", password: "password123" });
    expect(r.status).toBe(503);
    expect(r.json.error.code).toBe("TASK_HELPER_UNAVAILABLE");
  });
});
