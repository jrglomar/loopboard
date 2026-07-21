// AssignmentList tests — v1.8, ADR-019
// Keyless/offline — useActiveSprint, useTeamMembers (v1.8 swap), assignIssue all mocked.
// NOTE: v1.8 swaps useAssignableUsers → useTeamMembers; tests updated accordingly.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { AssignmentList } from "./AssignmentList";

// ── Mock hooks ────────────────────────────────────────────────────────────────

vi.mock("../hooks/useJira", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useJira")>();
  return {
    ...actual,
    useActiveSprint: vi.fn(),
    useTeamMembers: vi.fn(),
    updateTicketPoints: vi.fn(),   // v1.37 (ADR-047): inline points edit
    updateTicketSummary: vi.fn(),  // v1.69 (ADR-080): inline rename
    // v1.59 (ADR-071): idle/empty shape (anti-drift parity — see Reports.test.tsx's comment).
    useMultiSprintReport: vi.fn().mockReturnValue({ data: null, loading: false, error: null, run: vi.fn() }),
  };
});

vi.mock("../lib/assignClient", () => ({
  getAssignableUsers: vi.fn(),
  assignIssue: vi.fn(),
}));

vi.mock("../lib/ticketActionsClient", () => ({
  getTransitions: vi.fn(),
  transitionIssue: vi.fn(),
  moveIssueToSprint: vi.fn(),
}));

import * as useJiraModule from "../hooks/useJira";
import * as assignClientModule from "../lib/assignClient";
import * as ticketActionsModule from "../lib/ticketActionsClient";

const mkSprint = (id: number, name: string) => ({
  id, name, state: "future" as const,
  startDate: null, endDate: null, completeDate: null, goal: null, boardId: 10,
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

// v1.8: TeamMember (no active field — curated roster)
const TEAM_MEMBERS = [
  { accountId: "acc-1", displayName: "Alice" },
  { accountId: "acc-2", displayName: "Bob" },
];

const makeIssue = (
  key: string,
  summary: string,
  assignee: string | null = null,
  storyPoints: number | null = 5,
  assigneeAccountId: string | null = null
) => ({
  key,
  summary,
  status: "To Do",
  statusCategory: "todo" as const,
  assignee,
  assigneeAccountId,
  storyPoints,
  issueType: "Task",
  url: `https://jira.example.com/browse/${key}`,
  blocked: false,
});

const DEFAULT_SPRINT_DATA = {
  sprint: {
    id: 100,
    name: "Sprint 8",
    state: "future" as const,
    startDate: "2026-06-28T00:00:00.000Z",
    endDate: "2026-07-11T00:00:00.000Z",
    goal: null,
  },
  activeSprints: [],
  futureSprints: [],
  issuesByStatus: {
    todo: [makeIssue("DEV-10", "Implement feature X", null, 5, null)],
    // DEV-11: Alice is assigned (acc-1) — v1.8 pre-select by assigneeAccountId
    inprogress: [makeIssue("DEV-11", "Fix bug Y", "Alice", 3, "acc-1")],
    codereview: [],
    done: [],
  },
  totals: {
    total: 2,
    todo: 1,
    inprogress: 1,
    codereview: 0,
    done: 0,
    blocked: 0,
    storyPointsTotal: 8,
    storyPointsDone: 0,
    storyPointsCodeReview: 0,
  },
};

// ── Setup / teardown ──────────────────────────────────────────────────────────

function setDefaultMocks() {
  vi.mocked(useJiraModule.useActiveSprint).mockReturnValue({
    data: DEFAULT_SPRINT_DATA,
    loading: false,
    error: null,
    run: vi.fn(),
  });

  // v1.8: mock useTeamMembers (swapped from useAssignableUsers)
  vi.mocked(useJiraModule.useTeamMembers).mockReturnValue({
    data: TEAM_MEMBERS,
    loading: false,
    error: null,
    run: vi.fn(),
    save: vi.fn().mockResolvedValue(TEAM_MEMBERS),
  });

  vi.mocked(assignClientModule.assignIssue).mockResolvedValue({
    ticketKey: "DEV-10",
    accountId: "acc-1",
    assigned: true,
  });

  // v1.37 (ADR-047): inline points edit → update_ticket
  vi.mocked(useJiraModule.updateTicketPoints).mockResolvedValue({
    ticketKey: "DEV-10", updatedFields: ["storyPoints"],
  } as never);

  // v1.69 (ADR-080): inline rename → update_ticket
  vi.mocked(useJiraModule.updateTicketSummary).mockResolvedValue({
    ticketKey: "DEV-10", updatedFields: ["summary"],
  } as never);

  // v1.15 ticket-action defaults
  vi.mocked(ticketActionsModule.getTransitions).mockResolvedValue({
    ticketKey: "DEV-10",
    transitions: [{ id: "21", name: "Start Progress", to: { name: "In Progress", category: "inprogress" } }],
  });
  vi.mocked(ticketActionsModule.transitionIssue).mockResolvedValue({
    ticketKey: "DEV-10", status: "In Progress", statusCategory: "inprogress",
  });
  vi.mocked(ticketActionsModule.moveIssueToSprint).mockResolvedValue({
    ticketKey: "DEV-10", sprintId: 200,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setDefaultMocks();
});

afterEach(() => {
  cleanup();
});

// ── Tests: ticket rows ────────────────────────────────────────────────────────

describe("AssignmentList — ticket rows from sprint data", () => {
  it("renders a row per ticket across all buckets", async () => {
    render(<AssignmentList boardId={10} sprintId={100} projectKey="DEV" />);

    await waitFor(() => {
      // DEV-10 from todo bucket, DEV-11 from inprogress bucket
      expect(screen.getByRole("link", { name: /DEV-10/i })).toBeTruthy();
      expect(screen.getByRole("link", { name: /DEV-11/i })).toBeTruthy();
    });
  });

  it("renders ticket Jira links with target=_blank and rel=noopener", async () => {
    render(<AssignmentList boardId={10} sprintId={100} projectKey="DEV" />);

    await waitFor(() => screen.getByRole("link", { name: /DEV-10/i }));

    const link = screen.getByRole("link", { name: /DEV-10/i });
    expect(link.getAttribute("href")).toContain("/browse/DEV-10");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("renders ticket summaries", async () => {
    render(<AssignmentList boardId={10} sprintId={100} projectKey="DEV" />);

    await waitFor(() => {
      expect(screen.getByText("Implement feature X")).toBeTruthy();
      expect(screen.getByText("Fix bug Y")).toBeTruthy();
    });
  });

  it("renders story points per ticket", async () => {
    render(<AssignmentList boardId={10} sprintId={100} projectKey="DEV" />);

    await waitFor(() => {
      // v1.37 (ADR-047): points are now inline-editable inputs (not static text).
      // DEV-10 has 5 pts, DEV-11 has 3 pts
      expect(screen.getByDisplayValue("5")).toBeTruthy();
      expect(screen.getByDisplayValue("3")).toBeTruthy();
    });
  });
});

// ── Tests: assignee selects ───────────────────────────────────────────────────

describe("AssignmentList — assignee selects", () => {
  it("renders an assignee select for each ticket", async () => {
    render(<AssignmentList boardId={10} sprintId={100} projectKey="DEV" />);

    await waitFor(() => {
      // a11y: each select has aria-label including ticket key
      const sel1 = screen.getByRole("combobox", { name: /Assignee for DEV-10/i });
      const sel2 = screen.getByRole("combobox", { name: /Assignee for DEV-11/i });
      expect(sel1).toBeTruthy();
      expect(sel2).toBeTruthy();
    });
  });

  it("each select includes 'Unassigned' and all team members (v1.8)", async () => {
    render(<AssignmentList boardId={10} sprintId={100} projectKey="DEV" />);

    await waitFor(() => screen.getByRole("combobox", { name: /Assignee for DEV-10/i }));

    const select = screen.getByRole("combobox", { name: /Assignee for DEV-10/i }) as HTMLSelectElement;
    const optionTexts = Array.from(select.options).map((o) => o.text);

    expect(optionTexts).toContain("Unassigned");
    expect(optionTexts).toContain("Alice");
    expect(optionTexts).toContain("Bob");
  });

  it("v1.9: an off-team current assignee is a NORMAL selectable option (no '(not on team)' lock)", async () => {
    // DEV-77 is assigned to Charlie, who is NOT on the curated team
    vi.mocked(useJiraModule.useActiveSprint).mockReturnValue({
      data: {
        ...DEFAULT_SPRINT_DATA,
        issuesByStatus: {
          todo: [makeIssue("DEV-77", "Cross-team help", "Charlie", 2, "acc-99")],
          inprogress: [],
          codereview: [],
          done: [],
        },
      },
      loading: false,
      error: null,
      run: vi.fn(),
    });

    render(<AssignmentList boardId={10} sprintId={100} projectKey="DEV" />);

    const select = (await waitFor(() =>
      screen.getByRole("combobox", { name: /Assignee for DEV-77/i })
    )) as HTMLSelectElement;

    // Charlie appears as a selectable option and is pre-selected (value = acc-99)
    const charlie = Array.from(select.options).find((o) => o.text === "Charlie");
    expect(charlie).toBeTruthy();
    expect(charlie!.disabled).toBe(false);
    expect(select.value).toBe("acc-99");
    // The old disabled "(not on team)" label is gone
    expect(Array.from(select.options).some((o) => /not on team/i.test(o.text))).toBe(false);
  });

  it("a11y: select aria-label includes the ticket key", async () => {
    render(<AssignmentList boardId={10} sprintId={100} projectKey="DEV" />);

    await waitFor(() => {
      // aria-label should reference the ticket key
      expect(
        screen.getByRole("combobox", { name: "Assignee for DEV-10" })
      ).toBeTruthy();
    });
  });
});

// ── Tests: assign action ──────────────────────────────────────────────────────

describe("AssignmentList — changing select calls assignIssue", () => {
  it("calls assignIssue with correct ticketKey and accountId when selecting a user", async () => {
    vi.mocked(assignClientModule.assignIssue).mockResolvedValueOnce({
      ticketKey: "DEV-10",
      accountId: "acc-1",
      assigned: true,
    });

    render(<AssignmentList boardId={10} sprintId={100} projectKey="DEV" />);

    await waitFor(() => screen.getByRole("combobox", { name: /Assignee for DEV-10/i }));

    const select = screen.getByRole("combobox", { name: /Assignee for DEV-10/i });
    // Select Alice (acc-1)
    fireEvent.change(select, { target: { value: "acc-1" } });

    await waitFor(() => {
      expect(vi.mocked(assignClientModule.assignIssue)).toHaveBeenCalledWith(
        "DEV-10",
        "acc-1"
      );
    });
  });

  it("calls assignIssue with null when selecting Unassigned", async () => {
    // DEV-11 currently has Alice assigned
    vi.mocked(assignClientModule.assignIssue).mockResolvedValueOnce({
      ticketKey: "DEV-11",
      accountId: null,
      assigned: false,
    });

    render(<AssignmentList boardId={10} sprintId={100} projectKey="DEV" />);

    await waitFor(() => screen.getByRole("combobox", { name: /Assignee for DEV-11/i }));

    const select = screen.getByRole("combobox", { name: /Assignee for DEV-11/i });
    // Select "Unassigned" (value = "")
    fireEvent.change(select, { target: { value: "" } });

    await waitFor(() => {
      expect(vi.mocked(assignClientModule.assignIssue)).toHaveBeenCalledWith(
        "DEV-11",
        null
      );
    });
  });

  it("shows 'Saving…' indicator during the async call", async () => {
    // Delay resolution so we can observe the saving state
    let resolve: (v: unknown) => void;
    const pending = new Promise((res) => { resolve = res; });
    vi.mocked(assignClientModule.assignIssue).mockReturnValueOnce(
      pending as Promise<{ ticketKey: string; accountId: string | null; assigned: boolean }>
    );

    render(<AssignmentList boardId={10} sprintId={100} projectKey="DEV" />);

    await waitFor(() => screen.getByRole("combobox", { name: /Assignee for DEV-10/i }));

    const select = screen.getByRole("combobox", { name: /Assignee for DEV-10/i });
    fireEvent.change(select, { target: { value: "acc-1" } });

    await waitFor(() => {
      expect(screen.getByText(/Saving…/i)).toBeTruthy();
    });

    // Resolve so the test doesn't hang
    resolve!({ ticketKey: "DEV-10", accountId: "acc-1", assigned: true });
  });

  it("shows per-row inline error when assignIssue rejects (non-blocking)", async () => {
    vi.mocked(assignClientModule.assignIssue).mockRejectedValueOnce({
      code: "UPSTREAM",
      message: "Assignment failed — Jira returned 400",
    });

    render(<AssignmentList boardId={10} sprintId={100} projectKey="DEV" />);

    await waitFor(() => screen.getByRole("combobox", { name: /Assignee for DEV-10/i }));

    const select = screen.getByRole("combobox", { name: /Assignee for DEV-10/i });
    fireEvent.change(select, { target: { value: "acc-1" } });

    await waitFor(() => {
      // Inline error message should appear (not a modal, not a page-level alert)
      expect(screen.getByText(/Assignment failed/i)).toBeTruthy();
    });

    // The other ticket's select should still be usable (non-blocking)
    expect(screen.getByRole("combobox", { name: /Assignee for DEV-11/i })).toBeTruthy();
  });

  it("reverts to previous assignee on error", async () => {
    vi.mocked(assignClientModule.assignIssue).mockRejectedValueOnce({
      code: "UPSTREAM",
      message: "Jira rejected",
    });

    render(<AssignmentList boardId={10} sprintId={100} projectKey="DEV" />);

    await waitFor(() => screen.getByRole("combobox", { name: /Assignee for DEV-10/i }));

    const select = screen.getByRole("combobox", {
      name: /Assignee for DEV-10/i,
    }) as HTMLSelectElement;

    // Initially unassigned
    expect(select.value).toBe("");

    // Try to assign Alice
    fireEvent.change(select, { target: { value: "acc-1" } });

    // Wait for error to be surfaced
    await waitFor(() => {
      expect(screen.getByText(/Jira rejected/i)).toBeTruthy();
    });

    // Select should revert to unassigned
    await waitFor(() => {
      expect(select.value).toBe("");
    });
  });
});

// ── Tests: empty sprint ───────────────────────────────────────────────────────

describe("AssignmentList — empty sprint (future, no tickets yet)", () => {
  it("shows 'Add tickets above, then assign them here' when sprint has no issues", async () => {
    vi.mocked(useJiraModule.useActiveSprint).mockReturnValue({
      data: {
        ...DEFAULT_SPRINT_DATA,
        issuesByStatus: { todo: [], inprogress: [], codereview: [], done: [] },
        totals: {
          ...DEFAULT_SPRINT_DATA.totals,
          total: 0,
          todo: 0,
          inprogress: 0,
          storyPointsTotal: 0,
        },
      },
      loading: false,
      error: null,
      run: vi.fn(),
    });

    render(<AssignmentList boardId={10} sprintId={100} projectKey="DEV" />);

    await waitFor(() => {
      expect(
        screen.getByText(/Add tickets above, then assign them here/i)
      ).toBeTruthy();
    });
  });
});

// ── Tests: empty team (v1.8) ──────────────────────────────────────────────────

describe("AssignmentList — empty team roster (v1.8)", () => {
  it("shows 'No team members yet' note pointing to Manage team", async () => {
    // v1.8: empty team → note pointing to Manage team
    vi.mocked(useJiraModule.useTeamMembers).mockReturnValue({
      data: [],
      loading: false,
      error: null,
      run: vi.fn(),
      save: vi.fn().mockResolvedValue([]),
    });

    render(<AssignmentList boardId={10} sprintId={100} projectKey="DEV" />);

    await waitFor(() => {
      expect(screen.getByText(/No team members yet/i)).toBeTruthy();
    });
    // Should mention Manage team
    expect(screen.getByText(/Manage team/i)).toBeTruthy();
  });
});

// ── Tests: loading skeleton ───────────────────────────────────────────────────

describe("AssignmentList — loading state", () => {
  it("renders aria-busy skeleton while sprint data is loading", () => {
    vi.mocked(useJiraModule.useActiveSprint).mockReturnValue({
      data: null,
      loading: true,
      error: null,
      run: vi.fn(),
    });

    const { container } = render(
      <AssignmentList boardId={10} sprintId={100} projectKey="DEV" />
    );

    const busyEl = container.querySelector('[aria-busy="true"]');
    expect(busyEl).toBeTruthy();
  });
});

// ── Tests: bridge-down error (v1.8) ───────────────────────────────────────────

describe("AssignmentList — bridge-down error (v1.8)", () => {
  it("shows bridge-down error with start command and Retry button", async () => {
    vi.mocked(useJiraModule.useActiveSprint).mockReturnValue({
      data: null,
      loading: false,
      error: {
        code: "BRIDGE_DOWN",
        message: "Cannot reach jira bridge — run: npm run dev:jira:http",
      },
      run: vi.fn(),
    });
    // v1.8: mock useTeamMembers (not useAssignableUsers)
    vi.mocked(useJiraModule.useTeamMembers).mockReturnValue({
      data: null,
      loading: false,
      error: null,
      run: vi.fn(),
      save: vi.fn(),
    });

    render(<AssignmentList boardId={10} sprintId={100} projectKey="DEV" />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
    });
    expect(screen.getByText(/Jira bridge is offline/i)).toBeTruthy();
    expect(screen.getByText(/dev:jira:http/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Retry/i })).toBeTruthy();
  });
});

// ── Tests: v1.15 (ADR-026) — assignee filter + points, status, move ────────────

describe("AssignmentList — v1.15 assignee filter + points summary", () => {
  it("filters the ticket list by assignee and updates the points total", async () => {
    render(<AssignmentList boardId={10} sprintId={100} projectKey="DEV" />);
    await waitFor(() => screen.getByText("Implement feature X"));

    // Unfiltered: 2 tickets, 5 + 3 = 8 pts
    expect(screen.getByText(/8 pts/i)).toBeTruthy();

    // Filter to Alice (only DEV-11, 3 pts)
    fireEvent.change(screen.getByRole("combobox", { name: /Filter tickets by assignee/i }), {
      target: { value: "Alice" },
    });

    expect(screen.queryByText("Implement feature X")).toBeNull(); // DEV-10 hidden
    expect(screen.getByText("Fix bug Y")).toBeTruthy(); // DEV-11 shown
    expect(screen.getByText(/1 of 2 tickets/i)).toBeTruthy();
    expect(screen.getByText(/3 pts/i)).toBeTruthy();
  });
});

describe("AssignmentList — v1.15 status change", () => {
  it("lazy-loads transitions on 'Change' and applies the chosen one", async () => {
    const runSpy = vi.fn();
    vi.mocked(useJiraModule.useActiveSprint).mockReturnValue({
      data: DEFAULT_SPRINT_DATA, loading: false, error: null, run: runSpy,
    });

    render(<AssignmentList boardId={10} sprintId={100} projectKey="DEV" />);
    await waitFor(() => screen.getByText("Implement feature X"));

    fireEvent.click(screen.getByRole("button", { name: /Change status for DEV-10/i }));

    // Transitions fetched + the target status offered
    await waitFor(() => expect(vi.mocked(ticketActionsModule.getTransitions)).toHaveBeenCalledWith("DEV-10"));
    const statusSelect = await screen.findByRole("combobox", { name: /New status for DEV-10/i });
    await waitFor(() =>
      expect(Array.from((statusSelect as HTMLSelectElement).options).some((o) => o.text === "In Progress")).toBe(true)
    );

    fireEvent.change(statusSelect, { target: { value: "21" } });

    await waitFor(() =>
      expect(vi.mocked(ticketActionsModule.transitionIssue)).toHaveBeenCalledWith("DEV-10", "21")
    );
    // Refetches the sprint after the change
    await waitFor(() => expect(runSpy).toHaveBeenCalled());
  });
});

describe("AssignmentList — v1.15 move to sprint", () => {
  it("calls move_issue_to_sprint with the chosen sprint", async () => {
    const runSpy = vi.fn();
    vi.mocked(useJiraModule.useActiveSprint).mockReturnValue({
      data: DEFAULT_SPRINT_DATA, loading: false, error: null, run: runSpy,
    });

    render(
      <AssignmentList
        boardId={10}
        sprintId={100}
        projectKey="DEV"
        sprints={[mkSprint(200, "Sprint 9"), mkSprint(201, "Sprint 10")]}
      />
    );
    await waitFor(() => screen.getByText("Implement feature X"));

    fireEvent.change(screen.getByRole("combobox", { name: /Move DEV-10 to a sprint/i }), {
      target: { value: "200" },
    });

    await waitFor(() =>
      expect(vi.mocked(ticketActionsModule.moveIssueToSprint)).toHaveBeenCalledWith("DEV-10", 200)
    );
    await waitFor(() => expect(runSpy).toHaveBeenCalled());
  });
});

// ── Tests: v1.37 (ADR-047) — bulk assign + editable points ─────────────────────

describe("AssignmentList — v1.37 bulk assign", () => {
  it("assigns every selected ticket to the chosen developer", async () => {
    render(<AssignmentList boardId={10} sprintId={100} projectKey="DEV" />);
    await waitFor(() => screen.getByRole("checkbox", { name: "Select DEV-10" }));

    // Select both tickets → the bulk toolbar appears.
    fireEvent.click(screen.getByRole("checkbox", { name: "Select DEV-10" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select DEV-11" }));
    expect(await screen.findByText(/2 selected/i)).toBeTruthy();

    // Pick Bob (acc-2) and Apply.
    fireEvent.change(screen.getByRole("combobox", { name: /Bulk assign selected tickets to a developer/i }), {
      target: { value: "acc-2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(vi.mocked(assignClientModule.assignIssue)).toHaveBeenCalledWith("DEV-10", "acc-2");
      expect(vi.mocked(assignClientModule.assignIssue)).toHaveBeenCalledWith("DEV-11", "acc-2");
    });
  });

  it("select-all checks every visible ticket", async () => {
    render(<AssignmentList boardId={10} sprintId={100} projectKey="DEV" />);
    await waitFor(() => screen.getByRole("checkbox", { name: "Select all tickets" }));

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all tickets" }));

    expect(await screen.findByText(/2 selected/i)).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: "Select DEV-10" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "Select DEV-11" }) as HTMLInputElement).checked).toBe(true);
  });

  it("Apply is disabled until a developer is chosen", async () => {
    render(<AssignmentList boardId={10} sprintId={100} projectKey="DEV" />);
    await waitFor(() => screen.getByRole("checkbox", { name: "Select DEV-10" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select DEV-10" }));

    const apply = screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    fireEvent.change(screen.getByRole("combobox", { name: /Bulk assign selected tickets to a developer/i }), {
      target: { value: "acc-1" },
    });
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("AssignmentList — v1.37 editable points", () => {
  it("writes new points via update_ticket on blur", async () => {
    render(<AssignmentList boardId={10} sprintId={100} projectKey="DEV" />);
    const input = (await screen.findByLabelText("Story points for DEV-10")) as HTMLInputElement;
    expect(input.value).toBe("5");

    fireEvent.change(input, { target: { value: "8" } });
    fireEvent.blur(input);

    await waitFor(() =>
      expect(vi.mocked(useJiraModule.updateTicketPoints)).toHaveBeenCalledWith("DEV-10", 8)
    );
  });

  it("does not write when the value is unchanged", async () => {
    render(<AssignmentList boardId={10} sprintId={100} projectKey="DEV" />);
    const input = (await screen.findByLabelText("Story points for DEV-10")) as HTMLInputElement;

    fireEvent.blur(input); // committed on mount === current → no write
    await new Promise((r) => setTimeout(r, 0));
    expect(vi.mocked(useJiraModule.updateTicketPoints)).not.toHaveBeenCalled();
  });

  it("reverts the input when the write fails", async () => {
    vi.mocked(useJiraModule.updateTicketPoints).mockRejectedValueOnce({ code: "UPSTREAM", message: "nope" });
    render(<AssignmentList boardId={10} sprintId={100} projectKey="DEV" />);
    const input = (await screen.findByLabelText("Story points for DEV-10")) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "13" } });
    fireEvent.blur(input);

    await waitFor(() => expect(input.value).toBe("5")); // reverted to the committed value
  });
});

// ── Tests: v1.69 (ADR-080) — SummaryCell rename (extracted to ./ticketCells) ───

describe("AssignmentList — v1.69 (ADR-080) rename", () => {
  it("opens the rename editor, saves via updateTicketSummary, and refetches the sprint", async () => {
    const runSpy = vi.fn();
    vi.mocked(useJiraModule.useActiveSprint).mockReturnValue({
      data: DEFAULT_SPRINT_DATA, loading: false, error: null, run: runSpy,
    });

    render(<AssignmentList boardId={10} sprintId={100} projectKey="DEV" />);
    await waitFor(() => screen.getByText("Implement feature X"));

    fireEvent.click(screen.getByRole("button", { name: "Rename DEV-10" }));

    const input = (await screen.findByRole("textbox", {
      name: "New summary for DEV-10",
    })) as HTMLInputElement;
    expect(input.value).toBe("Implement feature X");

    fireEvent.change(input, { target: { value: "Implement feature X v2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save summary for DEV-10" }));

    await waitFor(() =>
      expect(vi.mocked(useJiraModule.updateTicketSummary)).toHaveBeenCalledWith(
        "DEV-10",
        "Implement feature X v2"
      )
    );
    // v1.69 (ADR-080): a successful rename refetches the sprint (onSaved -> sprintState.run)
    await waitFor(() => expect(runSpy).toHaveBeenCalled());
  });

  it("Cancel reverts to the original summary without writing", async () => {
    render(<AssignmentList boardId={10} sprintId={100} projectKey="DEV" />);
    await waitFor(() => screen.getByText("Implement feature X"));

    fireEvent.click(screen.getByRole("button", { name: "Rename DEV-10" }));
    const input = await screen.findByRole("textbox", { name: "New summary for DEV-10" });
    fireEvent.change(input, { target: { value: "Something else entirely" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel rename for DEV-10" }));

    await waitFor(() => {
      expect(screen.queryByRole("textbox", { name: "New summary for DEV-10" })).toBeNull();
      expect(screen.getByText("Implement feature X")).toBeTruthy();
    });
    expect(vi.mocked(useJiraModule.updateTicketSummary)).not.toHaveBeenCalled();
  });

  it("Escape also cancels the rename and reverts, same as the Cancel button", async () => {
    render(<AssignmentList boardId={10} sprintId={100} projectKey="DEV" />);
    await waitFor(() => screen.getByText("Implement feature X"));

    fireEvent.click(screen.getByRole("button", { name: "Rename DEV-10" }));
    const input = await screen.findByRole("textbox", { name: "New summary for DEV-10" });
    fireEvent.change(input, { target: { value: "Something else entirely" } });
    fireEvent.keyDown(input, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("textbox", { name: "New summary for DEV-10" })).toBeNull();
      expect(screen.getByText("Implement feature X")).toBeTruthy();
    });
    expect(vi.mocked(useJiraModule.updateTicketSummary)).not.toHaveBeenCalled();
  });

  it("reverts the input and shows an inline error when the write fails", async () => {
    vi.mocked(useJiraModule.updateTicketSummary).mockRejectedValueOnce({
      code: "UPSTREAM",
      message: "Jira rejected the rename",
    });
    render(<AssignmentList boardId={10} sprintId={100} projectKey="DEV" />);
    await waitFor(() => screen.getByText("Implement feature X"));

    fireEvent.click(screen.getByRole("button", { name: "Rename DEV-10" }));
    const input = await screen.findByRole("textbox", { name: "New summary for DEV-10" });
    fireEvent.change(input, { target: { value: "New broken summary" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByText(/Jira rejected the rename/i)).toBeTruthy();
    });
    // Reverted to the committed value; the editor stays open so the error is visible.
    const reverted = screen.getByRole("textbox", {
      name: "New summary for DEV-10",
    }) as HTMLInputElement;
    expect(reverted.value).toBe("Implement feature X");
  });
});
