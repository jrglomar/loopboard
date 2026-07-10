// HTTP bridge client for mcp-jira (:4001) and mcp-github (:4002)
// CONTRACTS.md §2, §6

/** Error thrown by callTool on bridge errors and network failures */
export interface McpError {
  code: string;
  message: string;
  issues?: unknown[];
}

/** Type-guard for McpError */
export function isMcpError(value: unknown): value is McpError {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "message" in value
  );
}

/** HTTP bridge base URLs — come from Vite env vars at bundle time */
const JIRA_BASE =
  (import.meta.env.VITE_MCP_JIRA_URL as string | undefined) ??
  "http://localhost:4001";

const GITHUB_BASE =
  (import.meta.env.VITE_MCP_GITHUB_URL as string | undefined) ??
  "http://localhost:4002";

function baseFor(server: "jira" | "github"): string {
  return server === "jira" ? JIRA_BASE : GITHUB_BASE;
}

/** Bridge-down start-command hints (spec §9 pattern) */
function bridgeDownMessage(server: "jira" | "github"): string {
  const cmd = server === "jira" ? "npm run dev:jira:http" : "npm run dev:github:http";
  return `Cannot reach ${server} bridge — run: ${cmd}`;
}

/**
 * Call an MCP tool via the HTTP bridge.
 *
 * POST `${base}/api/tools/${name}` with `input` as JSON body.
 * Unwraps `{ ok: true, data }` envelope.
 * Throws McpError on `ok: false` or network failure.
 */
export async function callTool<T>(
  server: "jira" | "github",
  name: string,
  input: unknown
): Promise<T> {
  const url = `${baseFor(server)}/api/tools/${name}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // v1.45 (ADR-055): send the session cookie so the bridge scopes tools to the signed-in
      // user's own Jira/GitHub. Unauthenticated → the bridge falls back to the shared .env.
      credentials: "include",
      body: JSON.stringify(input),
    });
  } catch {
    // Network failure — bridge is not running
    const err: McpError = {
      code: "BRIDGE_DOWN",
      message: bridgeDownMessage(server),
    };
    throw err;
  }

  // Parse envelope — even non-200 responses come as JSON per contract §2
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    const err: McpError = {
      code: "INTERNAL",
      message: `Bridge returned non-JSON response (status ${response.status})`,
    };
    throw err;
  }

  // Narrow envelope shape
  if (
    typeof body === "object" &&
    body !== null &&
    "ok" in body
  ) {
    const envelope = body as { ok: boolean; data?: T; error?: { code: string; message: string; issues?: unknown[] } };

    if (envelope.ok && "data" in envelope) {
      return envelope.data as T;
    }

    // ok: false — surface the bridge error
    if (envelope.error) {
      const err: McpError = {
        code: envelope.error.code,
        message: envelope.error.message,
        issues: envelope.error.issues,
      };
      throw err;
    }
  }

  // Unexpected shape
  const err: McpError = {
    code: "INTERNAL",
    message: `Unexpected response shape from ${server} bridge`,
  };
  throw err;
}
