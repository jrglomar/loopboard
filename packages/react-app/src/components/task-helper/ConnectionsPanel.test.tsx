// ConnectionsPanel tests — v1.44, ADR-054. Keyless/offline (connectionsClient mocked).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { ConnectionsPanel } from "./ConnectionsPanel";

vi.mock("../../lib/connectionsClient", () => ({
  getConnections: vi.fn(),
  putJiraConnection: vi.fn(),
  putGithubConnection: vi.fn(),
  deleteConnection: vi.fn(),
}));
import * as cc from "../../lib/connectionsClient";

const mocked = cc as unknown as Record<"getConnections" | "putJiraConnection" | "putGithubConnection" | "deleteConnection", ReturnType<typeof vi.fn>>;

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe("ConnectionsPanel (v1.44)", () => {
  it("shows the connect forms when nothing is connected", async () => {
    mocked.getConnections.mockResolvedValue({ jira: null, github: null });
    render(<ConnectionsPanel />);
    await waitFor(() => expect(screen.getByLabelText("Jira base URL")).toBeTruthy());
    expect(screen.getByRole("button", { name: /Connect Jira/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Connect GitHub/i })).toBeTruthy();
  });

  it("connecting Jira sends the token and then shows the masked status", async () => {
    mocked.getConnections.mockResolvedValue({ jira: null, github: null });
    mocked.putJiraConnection.mockResolvedValue({
      jira: { connected: true, baseUrl: "https://team.atlassian.net", email: "a@team.com", hint: "…1234" },
      github: null,
    });
    render(<ConnectionsPanel />);
    await waitFor(() => screen.getByLabelText("Jira base URL"));

    fireEvent.change(screen.getByLabelText("Jira base URL"), { target: { value: "https://team.atlassian.net" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@team.com" } });
    fireEvent.change(screen.getByLabelText("API token"), { target: { value: "secret-token-1234" } });
    fireEvent.click(screen.getByRole("button", { name: /Connect Jira/i }));

    await waitFor(() => expect(screen.getByText("https://team.atlassian.net")).toBeTruthy());
    expect(mocked.putJiraConnection).toHaveBeenCalledWith("https://team.atlassian.net", "a@team.com", "secret-token-1234");
    expect(screen.getByText(/1234/)).toBeTruthy(); // masked hint shown
    expect(screen.getByRole("button", { name: /Disconnect/i })).toBeTruthy();
  });

  it("disconnects a connected provider", async () => {
    mocked.getConnections.mockResolvedValue({
      jira: { connected: true, baseUrl: "https://team.atlassian.net", email: "a@team.com", hint: "…1234" },
      github: null,
    });
    mocked.deleteConnection.mockResolvedValue({ jira: null, github: null });
    render(<ConnectionsPanel />);
    await waitFor(() => screen.getByText("https://team.atlassian.net"));

    fireEvent.click(screen.getByRole("button", { name: /Disconnect/i }));
    await waitFor(() => expect(screen.getByLabelText("Jira base URL")).toBeTruthy()); // back to the form
    expect(mocked.deleteConnection).toHaveBeenCalledWith("jira");
  });
});
