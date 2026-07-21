// Connections page tests — v1.67, ADR-078. Keyless/offline (authClient + connectionsClient
// mocked). Covers the new self-service "Account" password-change card; the Jira/GitHub/AI panel
// itself is already covered by ConnectionsPanel.test.tsx.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { AuthProvider } from "../context/AuthContext";
import { Connections } from "./Connections";

vi.mock("../lib/authClient", () => ({
  getMe: vi.fn(),
  login: vi.fn(),
  signup: vi.fn(),
  logout: vi.fn(),
  changePassword: vi.fn(),
  isAuthApiError: (v: unknown) => typeof v === "object" && v !== null && "code" in v,
}));
vi.mock("../lib/connectionsClient", () => ({
  getMyContext: vi.fn(),
  getConnections: vi.fn(),
  putJiraConnection: vi.fn(),
  putGithubConnection: vi.fn(),
  putAiConnection: vi.fn(),
  deleteConnection: vi.fn(),
}));

import * as authClient from "../lib/authClient";
import * as connectionsClient from "../lib/connectionsClient";

const auth = authClient as unknown as Record<"getMe" | "changePassword", ReturnType<typeof vi.fn>>;
const conns = connectionsClient as unknown as Record<"getMyContext" | "getConnections", ReturnType<typeof vi.fn>>;

function renderPage() {
  return render(
    <AuthProvider>
      <Connections />
    </AuthProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.getMe.mockResolvedValue({ email: "a@team.com", role: "user" });
  conns.getMyContext.mockResolvedValue({
    ready: true,
    connections: { jira: null, github: null, ai: null },
    boards: { dev: [], po: [] },
  });
  conns.getConnections.mockResolvedValue({ jira: null, github: null, ai: null });
});
afterEach(() => cleanup());

describe("Connections page — Account card (v1.67, ADR-078)", () => {
  it("renders an Account card with current/new password fields", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("Current password")).toBeTruthy());
    expect(screen.getByLabelText("New password")).toBeTruthy();
    expect(screen.getByRole("button", { name: /change password/i })).toBeTruthy();
  });

  it("changes the password on the happy path and clears the fields", async () => {
    auth.changePassword.mockResolvedValue({ changed: true });
    renderPage();
    await waitFor(() => screen.getByLabelText("Current password"));

    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "oldpass123" } });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "newpass456" } });
    fireEvent.click(screen.getByRole("button", { name: /change password/i }));

    await waitFor(() => expect(auth.changePassword).toHaveBeenCalledWith("oldpass123", "newpass456"));
    await waitFor(() => expect(screen.getByText("Password updated.")).toBeTruthy());
    expect((screen.getByLabelText("Current password") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("New password") as HTMLInputElement).value).toBe("");
  });

  it("surfaces the server's message inline on 401 INVALID_PASSWORD", async () => {
    auth.changePassword.mockRejectedValue({ code: "INVALID_PASSWORD", message: "Current password is incorrect" });
    renderPage();
    await waitFor(() => screen.getByLabelText("Current password"));

    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "wrong" } });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "newpass456" } });
    fireEvent.click(screen.getByRole("button", { name: /change password/i }));

    await waitFor(() => expect(screen.getByText("Current password is incorrect")).toBeTruthy());
  });
});
