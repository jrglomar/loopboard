// useTeamMembers / useRecentAssignees hook tests — CONTRACTS.md §4.16 v1.8, ADR-019
// Keyless/offline — teamClient is mocked.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, cleanup, act } from "@testing-library/react";

// ── Mock teamClient ───────────────────────────────────────────────────────────

vi.mock("../lib/teamClient", () => ({
  getTeamMembers: vi.fn(),
  setTeamMembers: vi.fn(),
  getRecentAssignees: vi.fn(),
}));

import * as teamClientModule from "../lib/teamClient";
import { useTeamMembers, useRecentAssignees } from "./useJira";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MEMBERS = [
  { accountId: "acc-1", displayName: "Alice" },
  { accountId: "acc-2", displayName: "Bob" },
];

const RECENT = [
  { accountId: "acc-1", displayName: "Alice", ticketCount: 8 },
  { accountId: "acc-3", displayName: "Carol", ticketCount: 3 },
];

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  // resetAllMocks (not clearAllMocks) so queued `...Once` values from a prior
  // lazy test that never consumed them don't leak into the next test.
  vi.resetAllMocks();
});

afterEach(() => {
  cleanup();
});

// ── useTeamMembers — load ─────────────────────────────────────────────────────

describe("useTeamMembers — loading flow", () => {
  it("starts in loading state and resolves with team members", async () => {
    vi.mocked(teamClientModule.getTeamMembers).mockResolvedValueOnce(MEMBERS);

    const { result } = renderHook(() => useTeamMembers(10));

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual(MEMBERS);
    expect(result.current.error).toBeNull();
  });

  it("does not load when boardId is null", async () => {
    const { result } = renderHook(() => useTeamMembers(null));

    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
    expect(vi.mocked(teamClientModule.getTeamMembers)).not.toHaveBeenCalled();
  });

  it("returns [] (empty team) on first-run with no saved roster", async () => {
    vi.mocked(teamClientModule.getTeamMembers).mockResolvedValueOnce([]);

    const { result } = renderHook(() => useTeamMembers(10));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual([]);
  });
});

describe("useTeamMembers — error handling", () => {
  it("surfaces McpError on fetch failure", async () => {
    const bridgeError = { code: "BRIDGE_DOWN", message: "Cannot reach jira bridge" };
    vi.mocked(teamClientModule.getTeamMembers).mockRejectedValueOnce(bridgeError);

    const { result } = renderHook(() => useTeamMembers(10));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toMatchObject({ code: "BRIDGE_DOWN" });
    expect(result.current.data).toBeNull();
  });
});

describe("useTeamMembers — run() refetch", () => {
  it("run() triggers a refetch and returns updated data", async () => {
    vi.mocked(teamClientModule.getTeamMembers)
      .mockResolvedValueOnce(MEMBERS)
      .mockResolvedValueOnce([...MEMBERS, { accountId: "acc-3", displayName: "Carol" }]);

    const { result } = renderHook(() => useTeamMembers(10));

    await waitFor(() => {
      expect(result.current.data).toEqual(MEMBERS);
    });

    act(() => {
      result.current.run();
    });

    await waitFor(() => {
      expect(result.current.data?.length).toBe(3);
    });
  });
});

// ── useTeamMembers — save ─────────────────────────────────────────────────────

describe("useTeamMembers — save(members)", () => {
  it("calls setTeamMembers and updates local state", async () => {
    const updated = [...MEMBERS, { accountId: "acc-3", displayName: "Carol" }];
    vi.mocked(teamClientModule.getTeamMembers).mockResolvedValueOnce(MEMBERS);
    vi.mocked(teamClientModule.setTeamMembers).mockResolvedValueOnce(updated);

    const { result } = renderHook(() => useTeamMembers(10));

    await waitFor(() => {
      expect(result.current.data).toEqual(MEMBERS);
    });

    await act(async () => {
      await result.current.save(updated);
    });

    expect(vi.mocked(teamClientModule.setTeamMembers)).toHaveBeenCalledWith(10, updated);
    expect(result.current.data).toEqual(updated);
  });

  it("rolls back optimistic state when setTeamMembers throws", async () => {
    vi.mocked(teamClientModule.getTeamMembers).mockResolvedValueOnce(MEMBERS);
    vi.mocked(teamClientModule.setTeamMembers).mockRejectedValueOnce({
      code: "UPSTREAM",
      message: "Jira error",
    });

    const { result } = renderHook(() => useTeamMembers(10));

    await waitFor(() => {
      expect(result.current.data).toEqual(MEMBERS);
    });

    const newList = [MEMBERS[0]]; // remove Bob

    await expect(
      act(async () => {
        await result.current.save(newList);
      })
    ).rejects.toMatchObject({ code: "UPSTREAM" });

    // Rolled back to original MEMBERS
    expect(result.current.data).toEqual(MEMBERS);
  });
});

// ── useRecentAssignees ────────────────────────────────────────────────────────

describe("useRecentAssignees — lazy loading", () => {
  it("does NOT auto-fetch on mount", () => {
    vi.mocked(teamClientModule.getRecentAssignees).mockResolvedValueOnce(RECENT);

    renderHook(() => useRecentAssignees(10));

    // Should not have been called — lazy hook
    expect(vi.mocked(teamClientModule.getRecentAssignees)).not.toHaveBeenCalled();
  });

  it("run() triggers the fetch", async () => {
    vi.mocked(teamClientModule.getRecentAssignees).mockResolvedValueOnce(RECENT);

    const { result } = renderHook(() => useRecentAssignees(10));

    act(() => {
      result.current.run();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual(RECENT);
    expect(result.current.error).toBeNull();
  });

  it("surfaces error on fetch failure", async () => {
    vi.mocked(teamClientModule.getRecentAssignees).mockRejectedValueOnce({
      code: "BRIDGE_DOWN",
      message: "Cannot reach jira bridge",
    });

    const { result } = renderHook(() => useRecentAssignees(10));

    act(() => {
      result.current.run();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toMatchObject({ code: "BRIDGE_DOWN" });
    expect(result.current.data).toBeNull();
  });

  it("does not fetch when boardId is null", () => {
    const { result } = renderHook(() => useRecentAssignees(null));

    act(() => {
      result.current.run();
    });

    expect(vi.mocked(teamClientModule.getRecentAssignees)).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
  });
});
