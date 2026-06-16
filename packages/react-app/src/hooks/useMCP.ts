// Generic MCP hook — CONTRACTS.md §6
import { useState, useCallback } from "react";
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

  const run = useCallback(() => {
    setLoading(true);
    setError(null);
    fn()
      .then((result) => {
        setData(result);
        setLoading(false);
      })
      .catch((err: unknown) => {
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
