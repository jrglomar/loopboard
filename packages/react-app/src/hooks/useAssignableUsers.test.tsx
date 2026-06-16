// useAssignableUsers hook tests — CONTRACTS.md §4.15 v1.7, ADR-018
// Keyless/offline — assignClient is mocked.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, cleanup, act } from "@testing-library/react";

// ── Mock assignClient ─────────────────────────────────────────────────────────

vi.mock("../lib/assignClient", () => ({
  getAssignableUsers: vi.fn(),
  assignIssue: vi.fn(),
}));

import * as assignClientModule from "../lib/assignClient";
import { useAssignableUsers } from "./useJira";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const USERS = [
  { accountId: "acc-1", displayName: "Alice", active: true },
  { accountId: "acc-2", displayName: "Bob", active: true },
];

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useAssignableUsers — loading flow", () => {
  it("starts in loading state and resolves with users", async () => {
    vi.mocked(assignClientModule.getAssignableUsers).mockResolvedValueOnce(USERS);

    const { result } = renderHook(() =>
      useAssignableUsers({ projectKey: "DEV" })
    );

    // Initially loading
    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual(USERS);
    expect(result.current.error).toBeNull();
  });

  it("does not load when opts is null", async () => {
    const { result } = renderHook(() => useAssignableUsers(null));

    // Should not trigger a fetch
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
    expect(vi.mocked(assignClientModule.getAssignableUsers)).not.toHaveBeenCalled();
  });
});

describe("useAssignableUsers — error handling", () => {
  it("surfaces McpError on fetch failure", async () => {
    const bridgeError = { code: "BRIDGE_DOWN", message: "Cannot reach jira bridge" };
    vi.mocked(assignClientModule.getAssignableUsers).mockRejectedValueOnce(bridgeError);

    const { result } = renderHook(() =>
      useAssignableUsers({ projectKey: "DEV" })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toMatchObject({ code: "BRIDGE_DOWN" });
    expect(result.current.data).toBeNull();
  });

  it("wraps non-McpError as UNKNOWN", async () => {
    vi.mocked(assignClientModule.getAssignableUsers).mockRejectedValueOnce(
      new Error("Unexpected")
    );

    const { result } = renderHook(() =>
      useAssignableUsers({ projectKey: "DEV" })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error?.code).toBe("UNKNOWN");
  });
});

describe("useAssignableUsers — run() refetch", () => {
  it("run() triggers a refetch and returns updated data", async () => {
    vi.mocked(assignClientModule.getAssignableUsers)
      .mockResolvedValueOnce(USERS)
      .mockResolvedValueOnce([...USERS, { accountId: "acc-3", displayName: "Carol", active: true }]);

    const { result } = renderHook(() =>
      useAssignableUsers({ projectKey: "DEV" })
    );

    await waitFor(() => {
      expect(result.current.data).toEqual(USERS);
    });

    act(() => {
      result.current.run();
    });

    await waitFor(() => {
      expect(result.current.data?.length).toBe(3);
    });
  });
});

describe("useAssignableUsers — opts change", () => {
  it("reloads when projectKey changes", async () => {
    vi.mocked(assignClientModule.getAssignableUsers)
      .mockResolvedValueOnce(USERS)
      .mockResolvedValueOnce([{ accountId: "acc-9", displayName: "PO User", active: true }]);

    let projectKey = "DEV";
    const { result, rerender } = renderHook(() =>
      useAssignableUsers({ projectKey })
    );

    await waitFor(() => {
      expect(result.current.data).toEqual(USERS);
    });

    projectKey = "PO";
    rerender();

    await waitFor(() => {
      expect(result.current.data?.length).toBe(1);
      expect(result.current.data?.[0].displayName).toBe("PO User");
    });
  });
});
