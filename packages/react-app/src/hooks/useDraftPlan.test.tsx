// useDraftPlan hook tests — CONTRACTS.md §4.30 v1.68, ADR-079
// Keyless/offline — draftPlanClient is mocked.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, cleanup, act } from "@testing-library/react";

// ── Mock draftPlanClient ──────────────────────────────────────────────────────

vi.mock("../lib/draftPlanClient", () => ({
  getDraftPlan: vi.fn(),
  setDraftPlan: vi.fn(),
}));

import * as draftPlanClientModule from "../lib/draftPlanClient";
import { useDraftPlan } from "./useJira";
import type { DraftAssignment, DraftPlan } from "../lib/types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ALICE: DraftAssignment = { accountId: "acc-1", displayName: "Alice" };
const BOB: DraftAssignment = { accountId: "acc-2", displayName: "Bob" };

const PLAN: DraftPlan = {
  sprintId: 100,
  devSprintId: 200,
  assignments: { "PO-1": ALICE },
};

const EMPTY_PLAN: DraftPlan = { sprintId: 100, devSprintId: null, assignments: {} };

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  // resetAllMocks (not clearAllMocks) so queued `...Once` values from a prior
  // lazy test that never consumed them don't leak into the next test.
  vi.resetAllMocks();
});

afterEach(() => {
  cleanup();
});

// ── Loading flow ──────────────────────────────────────────────────────────────

describe("useDraftPlan — loading flow", () => {
  it("starts in loading state and resolves with the draft plan", async () => {
    vi.mocked(draftPlanClientModule.getDraftPlan).mockResolvedValueOnce(PLAN);

    const { result } = renderHook(() => useDraftPlan(100));

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual(PLAN);
    expect(result.current.error).toBeNull();
    expect(vi.mocked(draftPlanClientModule.getDraftPlan)).toHaveBeenCalledWith(100);
  });

  it("does not load when sprintId is null", () => {
    const { result } = renderHook(() => useDraftPlan(null));

    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
    expect(vi.mocked(draftPlanClientModule.getDraftPlan)).not.toHaveBeenCalled();
  });

  it("returns the empty-draft shape when no draft has been saved yet", async () => {
    vi.mocked(draftPlanClientModule.getDraftPlan).mockResolvedValueOnce(EMPTY_PLAN);

    const { result } = renderHook(() => useDraftPlan(100));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(EMPTY_PLAN);
  });

  it("resets data/error when sprintId transitions back to null", async () => {
    vi.mocked(draftPlanClientModule.getDraftPlan).mockResolvedValueOnce(PLAN);

    const { result, rerender } = renderHook(({ sprintId }) => useDraftPlan(sprintId), {
      initialProps: { sprintId: 100 as number | null },
    });

    await waitFor(() => expect(result.current.data).toEqual(PLAN));

    rerender({ sprintId: null });

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });
});

describe("useDraftPlan — error handling", () => {
  it("surfaces McpError on fetch failure", async () => {
    const bridgeError = { code: "BRIDGE_DOWN", message: "Cannot reach jira bridge" };
    vi.mocked(draftPlanClientModule.getDraftPlan).mockRejectedValueOnce(bridgeError);

    const { result } = renderHook(() => useDraftPlan(100));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toMatchObject({ code: "BRIDGE_DOWN" });
    expect(result.current.data).toBeNull();
  });
});

describe("useDraftPlan — run() refetch", () => {
  it("run() triggers a refetch and returns updated data", async () => {
    vi.mocked(draftPlanClientModule.getDraftPlan)
      .mockResolvedValueOnce(EMPTY_PLAN)
      .mockResolvedValueOnce(PLAN);

    const { result } = renderHook(() => useDraftPlan(100));

    await waitFor(() => expect(result.current.data).toEqual(EMPTY_PLAN));

    act(() => {
      result.current.run();
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(PLAN);
    });
  });
});

// ── save() ────────────────────────────────────────────────────────────────────

describe("useDraftPlan — save(devSprintId, assignments)", () => {
  it("calls setDraftPlan with the full replacement and updates local state", async () => {
    vi.mocked(draftPlanClientModule.getDraftPlan).mockResolvedValueOnce(EMPTY_PLAN);
    vi.mocked(draftPlanClientModule.setDraftPlan).mockResolvedValueOnce(PLAN);

    const { result } = renderHook(() => useDraftPlan(100));
    await waitFor(() => expect(result.current.data).toEqual(EMPTY_PLAN));

    await act(async () => {
      await result.current.save(200, { "PO-1": ALICE });
    });

    expect(vi.mocked(draftPlanClientModule.setDraftPlan)).toHaveBeenCalledWith(100, 200, {
      "PO-1": ALICE,
    });
    expect(result.current.data).toEqual(PLAN);
  });

  it("applies the optimistic state synchronously before the server responds", async () => {
    vi.mocked(draftPlanClientModule.getDraftPlan).mockResolvedValueOnce(EMPTY_PLAN);
    let resolveSave: (v: DraftPlan) => void;
    const pending = new Promise<DraftPlan>((res) => { resolveSave = res; });
    vi.mocked(draftPlanClientModule.setDraftPlan).mockReturnValueOnce(pending);

    const { result } = renderHook(() => useDraftPlan(100));
    await waitFor(() => expect(result.current.data).toEqual(EMPTY_PLAN));

    let savePromise!: Promise<void>;
    act(() => {
      savePromise = result.current.save(200, { "PO-1": ALICE, "PO-2": BOB });
    });

    // Optimistic: applied before the server call resolves.
    expect(result.current.data).toEqual({
      sprintId: 100,
      devSprintId: 200,
      assignments: { "PO-1": ALICE, "PO-2": BOB },
    });

    resolveSave!(PLAN);
    await act(async () => { await savePromise; });
  });

  it("rolls back optimistic state and rethrows when setDraftPlan fails", async () => {
    vi.mocked(draftPlanClientModule.getDraftPlan).mockResolvedValueOnce(PLAN);
    vi.mocked(draftPlanClientModule.setDraftPlan).mockRejectedValueOnce({
      code: "UPSTREAM",
      message: "Jira error",
    });

    const { result } = renderHook(() => useDraftPlan(100));
    await waitFor(() => expect(result.current.data).toEqual(PLAN));

    await expect(
      act(async () => {
        await result.current.save(200, {});
      })
    ).rejects.toMatchObject({ code: "UPSTREAM" });

    // Rolled back to the pre-save PLAN
    expect(result.current.data).toEqual(PLAN);
  });

  it("is a no-op when sprintId is null", async () => {
    const { result } = renderHook(() => useDraftPlan(null));

    await act(async () => {
      await result.current.save(200, { "PO-1": ALICE });
    });

    expect(vi.mocked(draftPlanClientModule.setDraftPlan)).not.toHaveBeenCalled();
  });
});
