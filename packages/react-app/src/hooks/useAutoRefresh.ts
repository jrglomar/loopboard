// useAutoRefresh (v1.40, ADR-050) — re-run a fetch on a fixed interval so the Huddle stays
// truthful during standup. The callback is kept in a ref so a fresh closure never restarts
// the timer; the interval only restarts when `intervalMs`/`enabled` change.

import { useEffect, useRef } from "react";

export function useAutoRefresh(
  callback: () => void,
  intervalMs: number,
  enabled: boolean = true
): void {
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return;
    const id = setInterval(() => cbRef.current(), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled]);
}
