// boards.ts unit tests — CONTRACTS.md §2, ADR-017, v1.6
// All tests run keyless/offline — fetch is mocked.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getBoards } from "./boards";

// ── Stub fetch ────────────────────────────────────────────────────────────────

function stubFetch(body: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValueOnce({
      ok,
      status,
      json: () => Promise.resolve(body),
    })
  );
}

function stubFetchNetworkError() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValueOnce(new Error("network error"))
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── getBoards ─────────────────────────────────────────────────────────────────

describe("getBoards", () => {
  it("returns boards when health response has valid boards field", async () => {
    stubFetch({
      ok: true,
      service: "mcp-jira",
      version: "1.0.0",
      boards: {
        dev: { id: 10, projectKey: "DEV" },
        po: { id: 20, projectKey: "PO" },
      },
    });

    const result = await getBoards();
    expect(result).toEqual({
      dev: { id: 10, projectKey: "DEV" },
      po: { id: 20, projectKey: "PO" },
    });
  });

  it("returns null when health response is missing boards field (older bridge)", async () => {
    stubFetch({
      ok: true,
      service: "mcp-jira",
      version: "1.0.0",
      ai: { enabled: false, provider: null, model: null },
      // no boards field
    });

    const result = await getBoards();
    expect(result).toBeNull();
  });

  it("returns null when boards field is incomplete (missing po)", async () => {
    stubFetch({
      ok: true,
      boards: { dev: { id: 10, projectKey: "DEV" } },
    });

    const result = await getBoards();
    expect(result).toBeNull();
  });

  it("returns null when boards.dev.id is not a number", async () => {
    stubFetch({
      ok: true,
      boards: {
        dev: { id: "not-a-number", projectKey: "DEV" },
        po: { id: 20, projectKey: "PO" },
      },
    });

    const result = await getBoards();
    expect(result).toBeNull();
  });

  it("returns null when HTTP response is not ok (e.g. 503)", async () => {
    stubFetch({ ok: false, error: { code: "CONFIG" } }, false, 503);

    const result = await getBoards();
    expect(result).toBeNull();
  });

  it("returns null on network failure — never throws", async () => {
    stubFetchNetworkError();

    // Must not throw
    const result = await getBoards();
    expect(result).toBeNull();
  });

  it("returns null when response JSON is invalid / non-object", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve("not an object"),
      })
    );

    const result = await getBoards();
    expect(result).toBeNull();
  });
});
