/**
 * HTTP bridge integration tests.
 * Boots the express app on an ephemeral port (0), uses Node's global fetch.
 * No supertest, no real network to Jira.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import type { Server } from "http";
import { resetConfigCache } from "../src/lib/config.js";
import { UpstreamError } from "../src/lib/errors.js";

// ---- Mock jiraClient before importing http app ----
vi.mock("../src/lib/jiraClient.js", () => ({
  createIssue: vi.fn(),
  createIssueLink: vi.fn(),
  addIssuesToSprint: vi.fn(),
  getActiveSprints: vi.fn(),
  getActiveAndFutureSprints: vi.fn(),
  getSprintIssues: vi.fn(),
  getSprintsByState: vi.fn(),
  getSprintMeta: vi.fn(),
  createSprint: vi.fn(),
  getIssue: vi.fn(),
  updateIssue: vi.fn(),
  isBlocked: vi.fn(),
  mapIssue: vi.fn(),
  resetClientCache: vi.fn(),
}));

import * as jiraClient from "../src/lib/jiraClient.js";
import type { MockedObject } from "vitest";

const client = jiraClient as MockedObject<typeof jiraClient>;

// We need to set env before importing app (getConfig() is called at module load in http.ts)
process.env["JIRA_BASE_URL"] = "https://test.atlassian.net";
process.env["JIRA_EMAIL"] = "test@example.com";
process.env["JIRA_API_TOKEN"] = "test-token";
process.env["JIRA_PO_BOARD_ID"] = "10001";
process.env["JIRA_DEV_BOARD_ID"] = "10002";
process.env["VITEST"] = "true"; // prevent auto-listen in http.ts

resetConfigCache();

import { app, parseCorsOrigins } from "../src/http.js";

let server: Server;
let baseUrl: string;

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        const port =
          addr !== null && typeof addr === "object" ? addr.port : 0;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    })
);

afterAll(
  () =>
    new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    })
);

beforeEach(() => {
  vi.clearAllMocks();
});

// ---- Helpers ----

async function get(path: string) {
  return fetch(`${baseUrl}${path}`);
}

async function post(path: string, body: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---- Tests ----

describe("GET /api/health", () => {
  it("returns 200 with ok:true, service, and version", async () => {
    const res = await get("/api/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; service: string; version: string };
    expect(body.ok).toBe(true);
    expect(body.service).toBe("mcp-jira");
    expect(typeof body.version).toBe("string");
    expect(body.version.length).toBeGreaterThan(0);
  });

  it("returns boards with dev and po entries built from stubbed env (v1.6)", async () => {
    // Stubbed env: JIRA_DEV_BOARD_ID="10002", JIRA_PO_BOARD_ID="10001",
    // JIRA_DEV_PROJECT_KEY not set → default "DEV", JIRA_PO_PROJECT_KEY not set → default "PO"
    const res = await get("/api/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      boards: {
        dev: { id: number; projectKey: string };
        po: { id: number; projectKey: string };
      };
    };
    expect(body.ok).toBe(true);
    expect(body.boards).toBeDefined();

    // dev board
    expect(body.boards.dev.id).toBe(10002);
    expect(body.boards.dev.projectKey).toBe("DEV");

    // po board
    expect(body.boards.po.id).toBe(10001);
    expect(body.boards.po.projectKey).toBe("PO");
  });

  it("returns boards with explicit project keys when set", async () => {
    // Temporarily override project keys in env and reset config cache
    process.env["JIRA_DEV_PROJECT_KEY"] = "MYDEV";
    process.env["JIRA_PO_PROJECT_KEY"] = "MYPO";
    resetConfigCache();

    try {
      const res = await get("/api/health");
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        boards: {
          dev: { id: number; projectKey: string };
          po: { id: number; projectKey: string };
        };
      };
      expect(body.boards.dev.projectKey).toBe("MYDEV");
      expect(body.boards.po.projectKey).toBe("MYPO");
      // ids remain the same from stubbed env
      expect(body.boards.dev.id).toBe(10002);
      expect(body.boards.po.id).toBe(10001);
    } finally {
      // Restore defaults and re-cache
      delete process.env["JIRA_DEV_PROJECT_KEY"];
      delete process.env["JIRA_PO_PROJECT_KEY"];
      resetConfigCache();
    }
  });
});

describe("GET /api/tools", () => {
  it("returns 200 with list of tools", async () => {
    const res = await get("/api/tools");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: { name: string; description: string }[] };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    const names = body.data.map((t) => t.name);
    expect(names).toContain("create_po_ticket");
    expect(names).toContain("get_active_sprint");
    expect(names).toContain("get_daily_huddle");
  });

  it("each tool has name and description strings", async () => {
    const res = await get("/api/tools");
    const body = (await res.json()) as { data: { name: string; description: string }[] };
    for (const tool of body.data) {
      expect(typeof tool.name).toBe("string");
      expect(typeof tool.description).toBe("string");
    }
  });

  it("includes all v1.4 new tools", async () => {
    const res = await get("/api/tools");
    const body = (await res.json()) as { data: { name: string }[] };
    const names = body.data.map((t) => t.name);
    expect(names).toContain("create_sprint");
    expect(names).toContain("list_sprints");
    expect(names).toContain("get_sprint_report");
    expect(names).toContain("get_velocity");
  });
});

describe("POST /api/tools/:name — 404 UNKNOWN_TOOL", () => {
  it("returns 404 with UNKNOWN_TOOL code for unknown tool name", async () => {
    const res = await post("/api/tools/does_not_exist", {});
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; error: { code: string; message: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("UNKNOWN_TOOL");
  });
});

describe("POST /api/tools/create_po_ticket — 400 VALIDATION", () => {
  it("returns 400 with VALIDATION code and issues array on bad input", async () => {
    // summary is required; pass an empty object
    const res = await post("/api/tools/create_po_ticket", {});
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      ok: boolean;
      error: { code: string; message: string; issues?: unknown[] };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION");
    expect(Array.isArray(body.error.issues)).toBe(true);
    expect((body.error.issues as unknown[]).length).toBeGreaterThan(0);
  });
});

describe("POST /api/tools/create_po_ticket — 502 UPSTREAM", () => {
  it("returns 502 with UPSTREAM code when tool throws UpstreamError", async () => {
    client.createIssue.mockRejectedValueOnce(
      new UpstreamError(
        "Jira authentication failed — check JIRA_EMAIL / JIRA_API_TOKEN",
        401
      )
    );

    const res = await post("/api/tools/create_po_ticket", {
      summary: "Test",
      description: "Desc",
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("UPSTREAM");
  });
});

describe("POST /api/tools/get_ticket — happy path", () => {
  it("returns 200 with ok:true and data on success", async () => {
    client.getIssue.mockResolvedValueOnce({
      key: "DEV-1",
      url: "https://test.atlassian.net/browse/DEV-1",
      summary: "A task",
      description: "Some text",
      status: "In Progress",
      statusCategory: "inprogress",
      assignee: "Bob",
      reporter: "Alice",
      storyPoints: 2,
      issueType: "Task",
      labels: [],
      created: "2026-01-01T00:00:00.000+0000",
      updated: "2026-06-01T00:00:00.000+0000",
    });

    const res = await post("/api/tools/get_ticket", { ticketKey: "DEV-1" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: { key: string } };
    expect(body.ok).toBe(true);
    expect(body.data.key).toBe("DEV-1");
  });
});

describe("POST /api/tools/update_ticket — 400 VALIDATION via .refine()", () => {
  it("returns 400 VALIDATION when ticketKey is provided but neither summary nor description is present", async () => {
    // Exercises the fullSchema.refine() path inside the handler:
    // { ticketKey } passes baseSchema but fails the refine because summary and
    // description are both absent.  The HTTP bridge must surface this as a 400
    // VALIDATION envelope (not a 500 or silent pass-through).
    const res = await post("/api/tools/update_ticket", { ticketKey: "DEV-1" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      ok: boolean;
      error: { code: string; message: string; issues?: unknown[] };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION");
    // The refine message must appear somewhere in the response
    const detail = JSON.stringify(body.error);
    expect(detail).toMatch(/summary|description/i);
  });
});

describe("CORS headers", () => {
  it("includes CORS headers for allowed origin", async () => {
    const res = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: "http://localhost:5173" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:5173"
    );
  });
});

describe("parseCorsOrigins (CORS_ORIGINS env, deploy config)", () => {
  it("defaults to the dev origins when unset/empty", () => {
    expect(parseCorsOrigins(undefined)).toEqual([
      "http://localhost:5173",
      "http://127.0.0.1:5173",
    ]);
    expect(parseCorsOrigins("   ")).toEqual([
      "http://localhost:5173",
      "http://127.0.0.1:5173",
    ]);
  });

  it("splits a comma-separated list and trims whitespace", () => {
    expect(
      parseCorsOrigins("https://app.example.com, http://localhost:8080")
    ).toEqual(["https://app.example.com", "http://localhost:8080"]);
  });

  it("supports the '*' wildcard", () => {
    expect(parseCorsOrigins("*")).toEqual(["*"]);
  });
});
