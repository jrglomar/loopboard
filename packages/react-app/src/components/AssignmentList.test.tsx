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
  };
});

vi.mock("../lib/assignClient", () => ({
  getAssignableUsers: vi.fn(),
  assignIssue: vi.fn(),
}));

import * as useJiraModule from "../hooks/useJira";
import * as assignClientModule from "../lib/assignClient";

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
      // DEV-10 has 5 pts, DEV-11 has 3 pts
      expect(screen.getByText("5")).toBeTruthy();
      expect(screen.getByText("3")).toBeTruthy();
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
