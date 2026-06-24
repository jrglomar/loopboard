// Generic MCP hook — CONTRACTS.md §6
import { useState, useCallback, useRef } from "react";
import { type McpError } from "../lib/mcpClient";

export interface UseMCPState<T> {
  data: T | null;
  error: McpError | null;
  loading: boolean;
  run: () => void;
}

/**
 * Generic hook wrapping an async MCP call.
 * Caller provides a stable `fn` reference (use useCallback to avoid re-triggers).
 *
 * // perf: fn is called only when `run` is invoked — no auto-fetch on mount.
 *          Callers that want auto-fetch call run() inside useEffect.
 */
export function useMCP<T>(fn: () => Promise<T>): UseMCPState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<McpError | null>(null);
  const [loading, setLoading] = useState(false);

  // Monotonic request id — guards against out-of-order resolutions. When `fn`
  // changes (e.g. a board-aware hook's boardId resolves from undefined → a real
  // id), run() fires again; without this guard a slow earlier call could land
  // AFTER the newer one and clobber its data. (Fixes the PO sprint select showing
  // Dev sprints: the initial no-boardId fetch defaults to Dev and could overwrite
  // the correct PO fetch.) Only the latest run's resolution is applied.
  const reqIdRef = useRef(0);

  const run = useCallback(() => {
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    fn()
      .then((result) => {
        if (reqId !== reqIdRef.current) return; // superseded by a newer run()
        setData(result);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (reqId !== reqIdRef.current) return; // superseded by a newer run()
        // Narrow to McpError or create a generic one
        if (
          typeof err === "object" &&
          err !== null &&
          "code" in err &&
          "message" in err
        ) {
          setError(err as McpError);
        } else {
          setError({
            code: "UNKNOWN",
            message: String(err),
          });
        }
        setLoading(false);
      });
  }, [fn]);

  return { data, error, loading, run };
}
