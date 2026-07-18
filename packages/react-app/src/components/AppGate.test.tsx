// AppGate tests — v1.45, ADR-055. The app-wide gate: login → connect accounts → app.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { AppGate } from "./AppGate";
import { AuthProvider } from "../context/AuthContext";

vi.mock("../lib/authClient", () => ({
  getMe: vi.fn(),
  login: vi.fn(),
  signup: vi.fn(),
  logout: vi.fn(),
  isAuthApiError: (v: unknown) => typeof v === "object" && v !== null && "code" in v,
}));
vi.mock("../lib/connectionsClient", () => ({
  getMyContext: vi.fn(),
  getConnections: vi.fn().mockResolvedValue({ jira: null, github: null, ai: null }),
  putJiraConnection: vi.fn(),
  putGithubConnection: vi.fn(),
  putAiConnection: vi.fn(),
  deleteConnection: vi.fn(),
}));

import * as authClient from "../lib/authClient";
import * as connectionsClient from "../lib/connectionsClient";

const auth = authClient as unknown as Record<"getMe", ReturnType<typeof vi.fn>>;
const conns = connectionsClient as unknown as Record<"getMyContext", ReturnType<typeof vi.fn>>;

function renderGate() {
  return render(
    <AuthProvider>
      <AppGate><div>PROTECTED APP</div></AppGate>
    </AuthProvider>
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe("AppGate (v1.45)", () => {
  it("shows the login form (not the app) when not signed in", async () => {
    auth.getMe.mockRejectedValue({ code: "UNAUTHENTICATED", message: "Sign in" });
    renderGate();
    await waitFor(() => expect(screen.getByText(/Sign in to InvokeBoard/i)).toBeTruthy());
    expect(screen.queryByText("PROTECTED APP")).toBeNull();
  });

  it("shows the onboarding (connect accounts), not the app, when signed in but not ready", async () => {
    auth.getMe.mockResolvedValue({ email: "a@team.com" });
    conns.getMyContext.mockResolvedValue({
      ready: false,
      connections: { jira: null, github: null, ai: null },
      boards: { dev: [], po: [] },
    });
    renderGate();
    await waitFor(() => expect(screen.getByText(/Connect your accounts/i)).toBeTruthy());
    expect(screen.queryByText("PROTECTED APP")).toBeNull();
  });

  it("renders the app once signed in AND ready (Jira + GitHub connected)", async () => {
    auth.getMe.mockResolvedValue({ email: "a@team.com" });
    conns.getMyContext.mockResolvedValue({
      ready: true,
      connections: {
        jira: { connected: true, baseUrl: "x", email: "a@team.com", hint: "…1" },
        github: { connected: true, login: "a", hint: "…2" },
        ai: null,
      },
      boards: { dev: [], po: [] },
    });
    renderGate();
    await waitFor(() => expect(screen.getByText("PROTECTED APP")).toBeTruthy());
  });
});
