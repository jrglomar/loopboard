import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { callTool, type McpError } from "./mcpClient";

// Mock fetch globally — vitest 2.x vi.fn() infers overload types automatically
const mockFetch = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Helper: build a Response-like object */
function makeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("mcpClient.callTool", () => {
  it("unwraps { ok: true, data } envelope and returns data", async () => {
    const payload = { sprint: { id: 1, name: "Sprint 1" } };
    mockFetch.mockResolvedValueOnce(makeResponse({ ok: true, data: payload }));

    const result = await callTool<typeof payload>("jira", "get_active_sprint", {});
    expect(result).toEqual(payload);
  });

  it("throws McpError when ok: false", async () => {
    mockFetch.mockResolvedValueOnce(
      makeResponse(
        { ok: false, error: { code: "UNKNOWN_TOOL", message: "Tool not found" } },
        404
      )
    );

    await expect(callTool("jira", "nonexistent_tool", {})).rejects.toMatchObject({
      code: "UNKNOWN_TOOL",
      message: "Tool not found",
    });
  });

  it("throws McpError with BRIDGE_DOWN when fetch rejects (network error)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network failure"));

    await expect(callTool("jira", "get_active_sprint", {})).rejects.toMatchObject({
      code: "BRIDGE_DOWN",
    });
  });

  it("BRIDGE_DOWN message for jira mentions dev:jira:http command", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

    let thrown: McpError | null = null;
    try {
      await callTool("jira", "get_active_sprint", {});
    } catch (e) {
      thrown = e as McpError;
    }
    expect(thrown?.code).toBe("BRIDGE_DOWN");
    expect(thrown?.message).toContain("dev:jira:http");
  });

  it("BRIDGE_DOWN message for github mentions dev:github:http command", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

    let thrown: McpError | null = null;
    try {
      await callTool("github", "list_prs", {});
    } catch (e) {
      thrown = e as McpError;
    }
    expect(thrown?.code).toBe("BRIDGE_DOWN");
    expect(thrown?.message).toContain("dev:github:http");
  });

  it("includes issues array when server returns validation error", async () => {
    mockFetch.mockResolvedValueOnce(
      makeResponse(
        {
          ok: false,
          error: {
            code: "VALIDATION",
            message: "Validation failed",
            issues: [{ path: ["summary"], message: "Required" }],
          },
        },
        400
      )
    );

    let thrown: McpError | null = null;
    try {
      await callTool("jira", "create_po_ticket", {});
    } catch (e) {
      thrown = e as McpError;
    }
    expect(thrown?.code).toBe("VALIDATION");
    expect(thrown?.issues).toBeDefined();
    expect(Array.isArray(thrown?.issues)).toBe(true);
  });

  it("POSTs to jira base URL for jira server", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({ ok: true, data: {} }));
    await callTool("jira", "get_active_sprint", {});
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("4001");
    expect(url).toContain("get_active_sprint");
  });

  it("POSTs to github base URL for github server", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({ ok: true, data: {} }));
    await callTool("github", "list_prs", {});
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("4002");
    expect(url).toContain("list_prs");
  });

  it("sends JSON body with input", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({ ok: true, data: {} }));
    const input = { ticketKey: "DEV-99" };
    await callTool("jira", "get_ticket", input);
    const init = mockFetch.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual(input);
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("throws INTERNAL on non-JSON response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => { throw new Error("not json"); },
    } as unknown as Response);

    let thrown: McpError | null = null;
    try {
      await callTool("jira", "get_active_sprint", {});
    } catch (e) {
      thrown = e as McpError;
    }
    expect(thrown?.code).toBe("INTERNAL");
  });
});
