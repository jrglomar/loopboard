// TaskHelper page — v1.44/v1.46, ADR-054/055. Keyless/offline (all clients + hooks mocked).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { TaskHelper } from "./TaskHelper";

vi.mock("../lib/authClient", () => ({
  getMe: vi.fn(),
  login: vi.fn(),
  signup: vi.fn(),
  logout: vi.fn(),
  isAuthApiError: (v: unknown) => typeof v === "object" && v !== null && "code" in v,
}));
vi.mock("../lib/taskHelperClient", () => ({ getMyIssues: vi.fn(), runHelp: vi.fn() }));

// v1.47: connections moved to their own page; the page reads readiness from the auth context.
vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    context: {
      connections: { jira: { connected: true, baseUrl: "https://team.atlassian.net", email: "a@team.com", hint: "…1234" }, github: null, ai: null },
      ready: true, boards: { dev: [], po: [] }, role: "user",
    },
  }),
}));
// The journal has its own test; stub it here so this file stays about the ticket→prompt flow.
vi.mock("../components/task-helper/SprintJournalCard", () => ({
  SprintJournalCard: ({ sprintId }: { sprintId: number }) => <div data-testid="journal">journal:{sprintId}</div>,
}));

// v1.46 (Phase F): the page now resolves the board + sprint it scopes tickets to.
vi.mock("../lib/boards", () => ({
  useBoards: () => ({
    boards: { dev: [{ id: 1038, projectKey: "VRDB" }], po: [{ id: 1011, projectKey: "VBPO" }] },
    loading: false,
  }),
}));
vi.mock("../hooks/useJira", () => ({ useSprintList: vi.fn() }));

import * as authClient from "../lib/authClient";
import * as taskHelperClient from "../lib/taskHelperClient";
import * as useJira from "../hooks/useJira";

const auth = authClient as unknown as Record<"getMe", ReturnType<typeof vi.fn>>;
const th = taskHelperClient as unknown as Record<"getMyIssues" | "runHelp", ReturnType<typeof vi.fn>>;

const SPRINTS = {
  active: [{ id: 501, name: "Sprint 42" }],
  future: [{ id: 502, name: "Sprint 43" }],
  closed: [{ id: 500, name: "Sprint 41" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  auth.getMe.mockResolvedValue({ email: "a@team.com" });
  vi.mocked(useJira.useSprintList).mockReturnValue({
    data: SPRINTS, loading: false, error: null, run: vi.fn(),
  } as unknown as ReturnType<typeof useJira.useSprintList>);
  th.getMyIssues.mockResolvedValue({
    issues: [{ key: "DEV-1", summary: "Fix login", status: "In Progress", url: "https://team.atlassian.net/browse/DEV-1" }],
  });
  th.runHelp.mockResolvedValue({ refinedText: "REFINED SPEC", prompt: "AGENT PROMPT" });
});
afterEach(() => cleanup());

describe("TaskHelper page (v1.44/v1.46)", () => {
  it("shows tickets for the ACTIVE sprint by default", async () => {
    render(<TaskHelper />);
    await waitFor(() => expect(screen.getByRole("option", { name: /DEV-1 — Fix login/i })).toBeTruthy());
    expect(screen.getByText("Task Helper")).toBeTruthy();
    // Phase F: scoped to the active sprint (501), not to every open sprint
    expect(th.getMyIssues).toHaveBeenCalledWith(501);
  });

  it("v1.47: no longer renders the connections panel, and mounts the journal for the sprint", async () => {
    render(<TaskHelper />);
    await waitFor(() => expect(screen.getByTestId("journal")).toBeTruthy());
    expect(screen.getByTestId("journal").textContent).toBe("journal:501");
    expect(screen.queryByText(/Your connections/i)).toBeNull();
  });

  it("refetches scoped to a newly selected sprint", async () => {
    render(<TaskHelper />);
    await waitFor(() => expect(th.getMyIssues).toHaveBeenCalledWith(501));

    fireEvent.change(screen.getByLabelText("Sprint"), { target: { value: "500" } });
    await waitFor(() => expect(th.getMyIssues).toHaveBeenCalledWith(500));
  });

  it("honours the shared sprint pick from App when controlled", async () => {
    render(<TaskHelper boardKey="dev" sprintId={502} onSprintChange={vi.fn()} />);
    await waitFor(() => expect(th.getMyIssues).toHaveBeenCalledWith(502));
  });

  it("runs the pipeline and shows the refined ticket + coding-agent prompt", async () => {
    render(<TaskHelper />);
    await waitFor(() => screen.getByRole("option", { name: /DEV-1/i }));

    fireEvent.click(screen.getByRole("button", { name: /Refine & build prompt/i }));

    await waitFor(() => expect(screen.getByText("REFINED SPEC")).toBeTruthy());
    expect(screen.getByText("AGENT PROMPT")).toBeTruthy();
    expect(th.runHelp).toHaveBeenCalledWith("DEV-1", undefined);
  });
});
