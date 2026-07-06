// useAutoRefresh (v1.40, ADR-050) — interval refetch. Fake timers; keyless/offline.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAutoRefresh } from "./useAutoRefresh";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useAutoRefresh", () => {
  it("fires the callback on each interval tick", () => {
    const cb = vi.fn();
    renderHook(() => useAutoRefresh(cb, 1000));
    vi.advanceTimersByTime(3500);
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it("always calls the LATEST callback (no stale closure)", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useAutoRefresh(cb, 1000), {
      initialProps: { cb: first },
    });
    vi.advanceTimersByTime(1000);
    rerender({ cb: second });
    vi.advanceTimersByTime(1000);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("does nothing when disabled and stops on unmount", () => {
    const cb = vi.fn();
    const { unmount } = renderHook(() => useAutoRefresh(cb, 1000, false));
    vi.advanceTimersByTime(5000);
    expect(cb).not.toHaveBeenCalled();

    const cb2 = vi.fn();
    const { unmount: unmount2 } = renderHook(() => useAutoRefresh(cb2, 1000));
    vi.advanceTimersByTime(1000);
    unmount2();
    vi.advanceTimersByTime(5000);
    expect(cb2).toHaveBeenCalledTimes(1);
    unmount();
  });
});
