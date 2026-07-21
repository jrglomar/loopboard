// Auth client (v1.44, ADR-054) — the app-wide login session (AppGate/AuthContext); talks to the
// mcp-jira bridge's /api/auth/*.
// All calls use `credentials: "include"` so the httpOnly session cookie flows both ways.

const JIRA_BASE =
  (import.meta.env.VITE_MCP_JIRA_URL as string | undefined) ?? "http://localhost:4001";

export interface AuthUser {
  email: string;
  role?: "admin" | "user"; // v1.45 (ADR-055) — present on /api/auth/me
}

export interface AuthApiError {
  code: string;
  message: string;
}

export function isAuthApiError(v: unknown): v is AuthApiError {
  return typeof v === "object" && v !== null && "code" in v && "message" in v;
}

/** Credentialed JSON fetch to the bridge — shared by the auth/connections/task clients. */
export async function credFetch<T>(path: string, method: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${JIRA_BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw { code: "BRIDGE_DOWN", message: "Cannot reach the server — run: npm run dev:jira:http" } as AuthApiError;
  }
  const json = (await res.json().catch(() => null)) as
    | { ok: true; data: T }
    | { ok: false; error: AuthApiError }
    | null;
  if (json && json.ok) return json.data;
  if (json && !json.ok && json.error) throw json.error;
  throw { code: "INTERNAL", message: `Request failed (${res.status})` } as AuthApiError;
}

/** Current user, or throws UNAUTHENTICATED / TASK_HELPER_UNAVAILABLE. */
export function getMe(): Promise<AuthUser> {
  return credFetch<AuthUser>("/api/auth/me", "GET");
}

export function signup(email: string, password: string): Promise<AuthUser> {
  return credFetch<AuthUser>("/api/auth/signup", "POST", { email, password });
}

export function login(email: string, password: string): Promise<AuthUser> {
  return credFetch<AuthUser>("/api/auth/login", "POST", { email, password });
}

export function logout(): Promise<{ loggedOut: boolean }> {
  return credFetch<{ loggedOut: boolean }>("/api/auth/logout", "POST");
}

/**
 * v1.67 (ADR-078) — self-service password change for the signed-in user (any role). Throws
 * `401 INVALID_PASSWORD` when `currentPassword` doesn't match; `400 VALIDATION` when `newPassword`
 * is under 8 chars.
 */
export function changePassword(currentPassword: string, newPassword: string): Promise<{ changed: boolean }> {
  return credFetch<{ changed: boolean }>("/api/auth/password", "PUT", { currentPassword, newPassword });
}
