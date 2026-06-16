import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import type { AddressInfo } from "net";
import { resetConfigCache } from "../src/lib/config.js";

// Mock client modules before importing the app
vi.mock("../src/lib/githubClient.js", () => ({
  githubClient: {
    listPrs: vi.fn(),
    getPr: vi.fn(),
    listComments: vi.fn(),
    postComment: vi.fn(),
  },
  resetGithubClientCache: vi.fn(),
}));

vi.mock("../src/lib/jiraClient.js", () => ({
  createRemoteLink: vi.fn(),
  resetJiraClientCache: vi.fn(),
}));

import { githubClient } from "../src/lib/githubClient.js";
import { createRemoteLink } from "../src/lib/jiraClient.js";
import { UpstreamError } from "../src/lib/errors.js";

// ---- Set up env before importing http module ----
process.env["GITHUB_TOKEN"] = "gh_test_http";
process.env["JIRA_BASE_URL"] = "https://acme.atlassian.net";
process.env["JIRA_EMAIL"] = "test@example.com";
process.env["JIRA_API_TOKEN"] = "jira_tok_http";
process.env["GITHUB_REPO"] = "owner/repo";
process.env["MCP_GITHUB_HTTP_PORT"] = "0"; // OS-assigned port for testing

resetConfigCache();

// Dynamic import after env is set
let baseUrl: string;
let closeServer: () => Promise<void>;

beforeAll(async () => {
  const mod = await import("../src/http.js");
  // Get OS-assigned port
  const address = mod.server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeServer = () =>
    new Promise((resolve, reject) => {
      mod.server.close((err) => (err ? reject(err) : resolve()));
    });
});

afterAll(async () => {
  await closeServer();
  resetConfigCache();
  delete process.env["GITHUB_TOKEN"];
  delete process.env["JIRA_BASE_URL"];
  delete process.env["JIRA_EMAIL"];
  delete process.env["JIRA_API_TOKEN"];
  delete process.env["GITHUB_REPO"];
  delete process.env["MCP_GITHUB_HTTP_PORT"];
});

beforeEach(() => {
  vi.clearAllMocks();
});

async function get(path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`);
  const body = await res.json() as unknown;
  return { status: res.status, body };
}

async function post(
  path: string,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json() as unknown;
  return { status: res.status, body: data };
}

describe("GET /api/health", () => {
  it("returns 200 with service and version", async () => {
    const { status, body } = await get("/api/health");
    expect(status).toBe(200);
    const b = body as { ok: boolean; service: string; version: string };
    expect(b.ok).toBe(true);
    expect(b.service).toBe("mcp-github");
    expect(typeof b.version).toBe("string");
    expect(b.version.length).toBeGreaterThan(0);
  });
});

describe("GET /api/tools", () => {
  it("returns list of tools with name and description", async () => {
    const { status, body } = await get("/api/tools");
    expect(status).toBe(200);
    const b = body as {
      ok: boolean;
      data: Array<{ name: string; description: string }>;
    };
    expect(b.ok).toBe(true);
    expect(Array.isArray(b.data)).toBe(true);
    expect(b.data.length).toBeGreaterThan(0);
    expect(b.data.every((t) => typeof t.name === "string")).toBe(true);
    expect(b.data.every((t) => typeof t.description === "string")).toBe(true);
    // Should include all four tools
    const names = b.data.map((t) => t.name);
    expect(names).toContain("list_prs");
    expect(names).toContain("get_pr");
    expect(names).toContain("link_pr_to_ticket");
    expect(names).toContain("sync_pr_links");
  });
});

describe("POST /api/tools/:name — unknown tool", () => {
  it("returns 404 with UNKNOWN_TOOL code", async () => {
    const { status, body } = await post("/api/tools/nonexistent_tool", {});
    expect(status).toBe(404);
    const b = body as { ok: boolean; error: { code: string } };
    expect(b.ok).toBe(false);
    expect(b.error.code).toBe("UNKNOWN_TOOL");
  });
});

describe("POST /api/tools/list_prs — validation error", () => {
  it("returns 400 with VALIDATION code and issues", async () => {
    // Pass invalid state value
    const { status, body } = await post("/api/tools/list_prs", {
      state: "invalid_state",
    });
    expect(status).toBe(400);
    const b = body as { ok: boolean; error: { code: string; issues?: unknown[] } };
    expect(b.ok).toBe(false);
    expect(b.error.code).toBe("VALIDATION");
    expect(b.error.issues).toBeDefined();
  });
});

describe("POST /api/tools/list_prs — upstream error (502)", () => {
  it("returns 502 with UPSTREAM code", async () => {
    vi.mocked(githubClient.listPrs).mockRejectedValue(
      new UpstreamError(
        "GitHub authentication failed — check GITHUB_TOKEN",
        401,
      ),
    );

    const { status, body } = await post("/api/tools/list_prs", {
      repo: "owner/repo",
      state: "open",
    });
    expect(status).toBe(502);
    const b = body as { ok: boolean; error: { code: string; message: string } };
    expect(b.ok).toBe(false);
    expect(b.error.code).toBe("UPSTREAM");
    expect(b.error.message).toContain("GitHub authentication failed");
  });
});

describe("POST /api/tools/list_prs — happy path", () => {
  it("returns 200 with ok:true and data", async () => {
    vi.mocked(githubClient.listPrs).mockResolvedValue([
      {
        number: 1,
        title: "DEV-1 test PR",
        body: null,
        state: "open",
        merged_at: null,
        draft: false,
        html_url: "https://github.com/owner/repo/pull/1",
        user: { login: "user" },
        head: { ref: "feature/DEV-1", sha: "sha1" },
        base: { ref: "main" },
        mergeable: null,
      },
    ]);

    const { status, body } = await post("/api/tools/list_prs", {
      repo: "owner/repo",
      state: "open",
    });
    expect(status).toBe(200);
    const b = body as { ok: boolean; data: { repo: string; prs: unknown[] } };
    expect(b.ok).toBe(true);
    expect(b.data.repo).toBe("owner/repo");
    expect(b.data.prs).toHaveLength(1);
  });
});

describe("POST /api/tools/link_pr_to_ticket — happy path", () => {
  it("returns 200 with link results", async () => {
    const mockPr = {
      number: 7,
      title: "DEV-7 add feature",
      body: null,
      state: "open" as const,
      merged_at: null,
      draft: false,
      html_url: "https://github.com/owner/repo/pull/7",
      user: { login: "dev" },
      head: { ref: "feature/DEV-7", sha: "sha7" },
      base: { ref: "main" },
      mergeable: null,
    };
    vi.mocked(githubClient.getPr).mockResolvedValue(mockPr);
    vi.mocked(githubClient.listComments).mockResolvedValue([]);
    vi.mocked(githubClient.postComment).mockResolvedValue(undefined);
    vi.mocked(createRemoteLink).mockResolvedValue(undefined);

    const { status, body } = await post("/api/tools/link_pr_to_ticket", {
      number: 7,
      ticketKey: "DEV-7",
    });
    expect(status).toBe(200);
    const b = body as {
      ok: boolean;
      data: { prUrl: string; results: unknown[] };
    };
    expect(b.ok).toBe(true);
    expect(b.data.results).toHaveLength(1);
  });
});

describe("parseCorsOrigins (CORS_ORIGINS env, deploy config)", () => {
  it("defaults to the dev origins when unset/empty", async () => {
    const { parseCorsOrigins } = await import("../src/http.js");
    expect(parseCorsOrigins(undefined)).toEqual([
      "http://localhost:5173",
      "http://127.0.0.1:5173",
    ]);
  });

  it("splits a comma-separated list, trims, and supports '*'", async () => {
    const { parseCorsOrigins } = await import("../src/http.js");
    expect(
      parseCorsOrigins("https://app.example.com, http://localhost:8080")
    ).toEqual(["https://app.example.com", "http://localhost:8080"]);
    expect(parseCorsOrigins("*")).toEqual(["*"]);
  });
});
