// useMCP tests — focus on the request-sequencing guard (out-of-order resolutions).
// Regression for the PO sprint select showing Dev sprints: a stale earlier fetch
// (no boardId → Dev default) could land after the correct PO fetch and clobber it.

import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMCP } from "./useMCP";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useMCP", () => {
  it("ignores a stale out-of-order resolution and keeps the latest run's data", async () => {
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    const fn = vi
      .fn<() => Promise<string>>()
      .mockReturnValueOnce(d1.promise)
      .mockReturnValueOnce(d2.promise);

    const { result } = renderHook(() => useMCP<string>(fn));

    // Fire two runs back-to-back (mirrors boardId resolving → refetch).
    act(() => result.current.run());
    act(() => result.current.run());

    // The newer (2nd) run resolves first with the correct value…
    await act(async () => {
      d2.resolve("PO");
      await d2.promise;
    });
    expect(result.current.data).toBe("PO");

    // …then the stale 1st run resolves late — it must NOT overwrite "PO".
    await act(async () => {
      d1.resolve("DEV");
      await d1.promise;
    });
    expect(result.current.data).toBe("PO");
  });

  it("applies data and clears loading on a normal single run", async () => {
    const d = deferred<string>();
    const fn = vi.fn<() => Promise<string>>().mockReturnValue(d.promise);

    const { result } = renderHook(() => useMCP<string>(fn));

    act(() => result.current.run());
    expect(result.current.loading).toBe(true);

    await act(async () => {
      d.resolve("ok");
      await d.promise;
    });
    expect(result.current.data).toBe("ok");
    expect(result.current.loading).toBe(false);
  });
});
