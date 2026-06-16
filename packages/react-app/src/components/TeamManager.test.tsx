// TeamManager tests — v1.8, ADR-019
// Keyless/offline — useTeamMembers and useRecentAssignees are mocked.
//
// Tests:
// - Renders team members as a list with Remove buttons
// - Remove calls save with the member removed
// - Recent assignees: Add button adds a member; already-on-team members are disabled
// - First-run (empty team): seed prompt + "Add all recent" seeds from get_recent_assignees
// - Empty state: shows "No team members yet" in the dialog
// - Loading / error states in the dialog

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { TeamManager } from "./TeamManager";

// ── Mock hooks ────────────────────────────────────────────────────────────────

vi.mock("../hooks/useJira", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useJira")>();
  return {
    ...actual,
    useTeamMembers: vi.fn(),
    useRecentAssignees: vi.fn(),
    // useAssignableUsers stays REAL (inert while search is closed: opts=null →
    // no fetch). The new "Search all people" test mocks the network boundary
    // (assignClient.getAssignableUsers) below instead.
  };
});

// v1.9: mock the assignClient network boundary so the real useAssignableUsers
// hook resolves with fixtures when the search section is opened.
vi.mock("../lib/assignClient", () => ({
  getAssignableUsers: vi.fn(),
  assignIssue: vi.fn(),
}));

import * as useJiraModule from "../hooks/useJira";
import * as assignClientModule from "../lib/assignClient";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TEAM = [
  { accountId: "acc-1", displayName: "Alice" },
  { accountId: "acc-2", displayName: "Bob" },
];

const RECENT = [
  { accountId: "acc-1", displayName: "Alice", ticketCount: 8 },
  { accountId: "acc-3", displayName: "Carol", ticketCount: 3 },
];

// ── Mock helpers ──────────────────────────────────────────────────────────────

function mockTeam(overrides: Partial<ReturnType<typeof useJiraModule.useTeamMembers>> = {}) {
  const mockSave = vi.fn().mockResolvedValue(TEAM);
  vi.mocked(useJiraModule.useTeamMembers).mockReturnValue({
    data: TEAM,
    loading: false,
    error: null,
    run: vi.fn(),
    save: mockSave,
    ...overrides,
  });
  return { mockSave };
}

function mockRecent(overrides: Partial<ReturnType<typeof useJiraModule.useRecentAssignees>> = {}) {
  vi.mocked(useJiraModule.useRecentAssignees).mockReturnValue({
    data: RECENT,
    loading: false,
    error: null,
    run: vi.fn(),
    ...overrides,
  });
}

// ── Open the dialog ───────────────────────────────────────────────────────────

async function openDialog() {
  const btn = screen.getByRole("button", { name: /Manage team/i });
  fireEvent.click(btn);
  // Wait for dialog to appear
  await waitFor(() => {
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

// ── Tests: trigger button ─────────────────────────────────────────────────────

describe("TeamManager — trigger button", () => {
  it("renders a 'Manage team' button", () => {
    mockTeam();
    mockRecent();
    render(<TeamManager boardId={10} />);
    expect(screen.getByRole("button", { name: /Manage team/i })).toBeTruthy();
  });

  it("opens the dialog when clicked", async () => {
    mockTeam();
    mockRecent();
    render(<TeamManager boardId={10} />);
    await openDialog();
    // Dialog title
    expect(screen.getByText("Manage Team")).toBeTruthy();
  });
});

// ── Tests: renders team members ───────────────────────────────────────────────

describe("TeamManager — team member list (v1.8)", () => {
  it("renders each team member's displayName", async () => {
    mockTeam();
    mockRecent();
    render(<TeamManager boardId={10} />);
    await openDialog();

    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.getByText("Bob")).toBeTruthy();
  });

  it("renders a 'Remove <name>' button for each team member", async () => {
    mockTeam();
    mockRecent();
    render(<TeamManager boardId={10} />);
    await openDialog();

    // a11y: buttons are labeled "Remove Alice" / "Remove Bob"
    expect(screen.getByRole("button", { name: /Remove Alice/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Remove Bob/i })).toBeTruthy();
  });

  it("calls save without the removed member when Remove is clicked", async () => {
    const { mockSave } = mockTeam();
    // save returns the remaining member
    mockSave.mockResolvedValueOnce([{ accountId: "acc-2", displayName: "Bob" }]);
    mockRecent();
    render(<TeamManager boardId={10} />);
    await openDialog();

    fireEvent.click(screen.getByRole("button", { name: /Remove Alice/i }));

    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledWith([{ accountId: "acc-2", displayName: "Bob" }]);
    });
  });
});

// ── Tests: recent assignees — Add button ──────────────────────────────────────

describe("TeamManager — add from recent activity (v1.8/v1.9)", () => {
  it("shows 'Add from recent activity' section that can be toggled", async () => {
    mockTeam();
    mockRecent();
    render(<TeamManager boardId={10} />);
    await openDialog();

    // The section header with show/hide toggle (v1.9: board-wide source)
    expect(screen.getByText(/Add from recent activity/i)).toBeTruthy();
    // Toggle button (disambiguated from the v1.9 search toggle)
    expect(screen.getByRole("button", { name: /show recent activity/i })).toBeTruthy();
  });

  it("shows recent assignees with ticket counts when section is opened", async () => {
    mockTeam();
    mockRecent();
    render(<TeamManager boardId={10} />);
    await openDialog();

    fireEvent.click(screen.getByRole("button", { name: /show recent activity/i }));

    await waitFor(() => {
      // Carol is not on team — should have an Add button
      expect(screen.getByRole("button", { name: /Add Carol/i })).toBeTruthy();
    });
    // Ticket counts
    expect(screen.getByText(/3 ticket/i)).toBeTruthy();
  });

  it("Alice (already on team) is marked as added — no 'Add Alice' button", async () => {
    mockTeam();
    mockRecent();
    render(<TeamManager boardId={10} />);
    await openDialog();

    fireEvent.click(screen.getByRole("button", { name: /show recent activity/i }));

    await waitFor(() => {
      // Carol has Add button
      expect(screen.getByRole("button", { name: /Add Carol/i })).toBeTruthy();
    });
    // Alice is already on team — no Add button for her in recent list
    expect(screen.queryByRole("button", { name: /Add Alice/i })).toBeNull();
  });

  it("clicking 'Add <name>' calls save with the member added", async () => {
    const { mockSave } = mockTeam();
    const newTeam = [...TEAM, { accountId: "acc-3", displayName: "Carol" }];
    mockSave.mockResolvedValueOnce(newTeam);
    mockRecent();
    render(<TeamManager boardId={10} />);
    await openDialog();

    fireEvent.click(screen.getByRole("button", { name: /show recent activity/i }));
    await waitFor(() => screen.getByRole("button", { name: /Add Carol/i }));
    fireEvent.click(screen.getByRole("button", { name: /Add Carol/i }));

    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ accountId: "acc-3", displayName: "Carol" }),
        ])
      );
    });
  });
});

// ── Tests: search all people (v1.9, ADR-020) ─────────────────────────────────

describe("TeamManager — search all people (v1.9)", () => {
  const ALL_USERS = [
    { accountId: "acc-1", displayName: "Alice", active: true }, // already on team
    { accountId: "acc-9", displayName: "Zoe Newcomer", active: true }, // not recent, not on team
  ];

  it("does not fetch assignable users until the search section is opened (lazy)", async () => {
    mockTeam();
    mockRecent();
    vi.mocked(assignClientModule.getAssignableUsers).mockResolvedValue(ALL_USERS);
    render(<TeamManager boardId={10} />);
    await openDialog();

    // Section header present, but no fetch yet (search closed)
    expect(screen.getByText(/Search all people/i)).toBeTruthy();
    expect(assignClientModule.getAssignableUsers).not.toHaveBeenCalled();
  });

  it("opening search fetches the full list; filters by name; Add seeds the team", async () => {
    const { mockSave } = mockTeam();
    mockRecent();
    vi.mocked(assignClientModule.getAssignableUsers).mockResolvedValue(ALL_USERS);
    render(<TeamManager boardId={10} />);
    await openDialog();

    // Open the search section → triggers the (mocked) fetch
    fireEvent.click(screen.getByRole("button", { name: /show all people search/i }));

    await waitFor(() => {
      expect(assignClientModule.getAssignableUsers).toHaveBeenCalledWith({ boardId: 10 });
    });

    // Zoe (not on team) has an Add button; Alice (on team) is marked added
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Add Zoe Newcomer/i })).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: /Add Alice/i })).toBeNull();

    // Filter by name → only Zoe matches "zoe"
    const searchBox = screen.getByRole("searchbox", { name: /search all assignable people/i });
    fireEvent.change(searchBox, { target: { value: "zoe" } });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Add Zoe Newcomer/i })).toBeTruthy();
    });

    // Add Zoe → save called with Zoe appended to the team
    fireEvent.click(screen.getByRole("button", { name: /Add Zoe Newcomer/i }));
    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ accountId: "acc-9", displayName: "Zoe Newcomer" }),
        ])
      );
    });
  });
});

// ── Tests: first-run (empty team) ────────────────────────────────────────────

describe("TeamManager — first-run empty team (v1.8)", () => {
  it("shows first-run callout when team is empty", async () => {
    const mockSave = vi.fn().mockResolvedValue([]);
    vi.mocked(useJiraModule.useTeamMembers).mockReturnValue({
      data: [],
      loading: false,
      error: null,
      run: vi.fn(),
      save: mockSave,
    });
    mockRecent();
    render(<TeamManager boardId={10} />);
    await openDialog();

    // First-run heading
    expect(screen.getByText(/Set up your team/i)).toBeTruthy();
  });

  it("shows 'Add all' button that seeds team from recent sprints", async () => {
    const mockSave = vi.fn().mockResolvedValue([
      { accountId: "acc-1", displayName: "Alice" },
      { accountId: "acc-3", displayName: "Carol" },
    ]);
    vi.mocked(useJiraModule.useTeamMembers).mockReturnValue({
      data: [],
      loading: false,
      error: null,
      run: vi.fn(),
      save: mockSave,
    });
    mockRecent();
    render(<TeamManager boardId={10} />);
    await openDialog();

    // "Add all" / "Add all from recent sprints"
    const addAllBtn = screen.getByRole("button", { name: /Add all from recent sprints/i });
    expect(addAllBtn).toBeTruthy();

    fireEvent.click(addAllBtn);

    await waitFor(() => {
      // Called save with all recent assignees (mapped to TeamMember)
      expect(mockSave).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ accountId: "acc-1", displayName: "Alice" }),
          expect.objectContaining({ accountId: "acc-3", displayName: "Carol" }),
        ])
      );
    });
  });

  it("empty team shows 'No team members yet' in the roster area", async () => {
    vi.mocked(useJiraModule.useTeamMembers).mockReturnValue({
      data: [],
      loading: false,
      error: null,
      run: vi.fn(),
      save: vi.fn(),
    });
    // No recent assignees loaded yet
    vi.mocked(useJiraModule.useRecentAssignees).mockReturnValue({
      data: null,
      loading: false,
      error: null,
      run: vi.fn(),
    });
    render(<TeamManager boardId={10} />);
    await openDialog();

    expect(screen.getByText(/No team members yet/i)).toBeTruthy();
  });
});

// ── Tests: loading state ──────────────────────────────────────────────────────

describe("TeamManager — loading state", () => {
  it("shows 'Loading team roster' while team is loading", async () => {
    vi.mocked(useJiraModule.useTeamMembers).mockReturnValue({
      data: null,
      loading: true,
      error: null,
      run: vi.fn(),
      save: vi.fn(),
    });
    mockRecent();
    render(<TeamManager boardId={10} />);
    await openDialog();

    expect(screen.getByText(/Loading team roster/i)).toBeTruthy();
  });
});

// ── Tests: error state ────────────────────────────────────────────────────────

describe("TeamManager — error state", () => {
  it("shows team load error and Retry button", async () => {
    vi.mocked(useJiraModule.useTeamMembers).mockReturnValue({
      data: null,
      loading: false,
      error: { code: "BRIDGE_DOWN", message: "Cannot reach jira bridge" },
      run: vi.fn(),
      save: vi.fn(),
    });
    mockRecent();
    render(<TeamManager boardId={10} />);
    await openDialog();

    expect(screen.getByText(/Cannot reach jira bridge/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Retry/i })).toBeTruthy();
  });
});
