// LeavesPlotterCard tests — v1.8, ADR-019
// Keyless/offline — useTeamMembers (v1.8 swap), useVelocity, useLeaves all mocked.
// NOTE: v1.8 swaps useAssignableUsers → useTeamMembers; tests updated accordingly.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { LeavesPlotterCard } from "./LeavesPlotterCard";
import type { SprintRef } from "../lib/types";

// ── Mock hooks ────────────────────────────────────────────────────────────────

vi.mock("../hooks/useJira", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useJira")>();
  return {
    ...actual,
    useTeamMembers: vi.fn(),
    useVelocity: vi.fn(),
    useLeaves: vi.fn(),
  };
});

import * as useJiraModule from "../hooks/useJira";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SPRINT_WITH_DATES: SprintRef = {
  id: 100,
  name: "Sprint 8 (Future)",
  state: "future",
  startDate: "2026-06-28T00:00:00.000Z", // Mon
  endDate: "2026-07-04T00:00:00.000Z",   // Sun → working days Mon–Fri (5 days)
  completeDate: null,
  goal: "Plan the feature",
  boardId: 10,
};

const SPRINT_NO_DATES: SprintRef = {
  ...SPRINT_WITH_DATES,
  startDate: null,
  endDate: null,
};

// v1.8: TeamMember (no active field — curated roster)
const TEAM_MEMBERS = [
  { accountId: "acc-1", displayName: "Alice" },
  { accountId: "acc-2", displayName: "Bob" },
];

const DEFAULT_VELOCITY = {
  boardId: 10,
  sprintCount: 3,
  sprints: [
    { id: 97, name: "Sprint 5", committedPoints: 30, completedPoints: 28, completeDate: "2026-04-28T00:00:00.000Z" },
    { id: 98, name: "Sprint 6", committedPoints: 35, completedPoints: 30, completeDate: "2026-05-12T00:00:00.000Z" },
    { id: 99, name: "Sprint 7", committedPoints: 40, completedPoints: 32, completeDate: "2026-06-14T00:00:00.000Z" },
  ],
  averageCompleted: 30,
  forecastNext: 30,
};

// ── Mock helpers ──────────────────────────────────────────────────────────────

function mockDefaults() {
  const mockSave = vi.fn().mockResolvedValue(undefined);

  // v1.8: mock useTeamMembers (swapped from useAssignableUsers)
  vi.mocked(useJiraModule.useTeamMembers).mockReturnValue({
    data: TEAM_MEMBERS,
    loading: false,
    error: null,
    run: vi.fn(),
    save: vi.fn().mockResolvedValue(TEAM_MEMBERS),
  });

  vi.mocked(useJiraModule.useVelocity).mockReturnValue({
    data: DEFAULT_VELOCITY,
    loading: false,
    error: null,
    run: vi.fn(),
  });

  vi.mocked(useJiraModule.useLeaves).mockReturnValue({
    data: {},
    loading: false,
    error: null,
    run: vi.fn(),
    save: mockSave,
  });

  return { mockSave };
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

// ── Tests: no-dates state ─────────────────────────────────────────────────────

describe("LeavesPlotterCard — no sprint dates", () => {
  it("shows 'Set sprint dates to plot leaves' when sprint has no dates", () => {
    mockDefaults();
    render(
      <LeavesPlotterCard
        boardId={10}
        sprintId={100}
        sprint={SPRINT_NO_DATES}
        projectKey="DEV"
      />
    );
    expect(screen.getByText(/Set sprint dates to plot leaves/i)).toBeTruthy();
  });

  it("shows the message when sprint prop is undefined", () => {
    mockDefaults();
    render(
      <LeavesPlotterCard
        boardId={10}
        sprintId={100}
        projectKey="DEV"
      />
    );
    expect(screen.getByText(/Set sprint dates to plot leaves/i)).toBeTruthy();
  });
});

// ── Tests: roster from team (v1.8: useTeamMembers, not get_assignable_users) ──

describe("LeavesPlotterCard — roster from useTeamMembers (v1.8)", () => {
  it("renders a row per user from the roster (not just sprint assignees)", () => {
    const { mockSave: _ } = mockDefaults();
    const { container } = render(
      <LeavesPlotterCard
        boardId={10}
        sprintId={100}
        sprint={SPRINT_WITH_DATES}
        projectKey="DEV"
      />
    );
    // Each user in the roster has a row header (scope="row")
    const rowHeaders = container.querySelectorAll('th[scope="row"]');
    expect(rowHeaders.length).toBe(2); // Alice, Bob
  });

  it("renders initials avatars for the roster", () => {
    mockDefaults();
    render(
      <LeavesPlotterCard
        boardId={10}
        sprintId={100}
        sprint={SPRINT_WITH_DATES}
        projectKey="DEV"
      />
    );
    // "AL" for Alice, "BO" for Bob
    expect(screen.getByText("AL")).toBeTruthy();
    expect(screen.getByText("BO")).toBeTruthy();
  });
});

// ── Tests: toggle calls save ──────────────────────────────────────────────────

describe("LeavesPlotterCard — toggle persists via setLeaves", () => {
  it("clicking a day cell calls save(assigneeName, dates)", async () => {
    const { mockSave } = mockDefaults();
    render(
      <LeavesPlotterCard
        boardId={10}
        sprintId={100}
        sprint={SPRINT_WITH_DATES}
        projectKey="DEV"
      />
    );

    // Click the first un-pressed toggle button
    const unpressed = screen.getAllByRole("button").find(
      (btn) => btn.getAttribute("aria-pressed") === "false"
    );
    expect(unpressed).toBeTruthy();
    if (unpressed) {
      fireEvent.click(unpressed);
    }

    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledOnce();
    });

    const [name, dates] = mockSave.mock.calls[0];
    // name should be one of the roster names
    expect(["Alice", "Bob"]).toContain(name);
    expect(dates.length).toBeGreaterThan(0);
  });
});

// ── Tests: capacity line ──────────────────────────────────────────────────────

describe("LeavesPlotterCard — capacity summary", () => {
  it("renders the capacity summary panel with 'Possible committed velocity'", () => {
    mockDefaults();
    render(
      <LeavesPlotterCard
        boardId={10}
        sprintId={100}
        sprint={SPRINT_WITH_DATES}
        projectKey="DEV"
      />
    );
    // May appear in multiple DOM elements (parent/child) — use getAllByText
    expect(screen.getAllByText(/Possible committed velocity/i).length).toBeGreaterThanOrEqual(1);
  });

  it("shows 'not a commitment' heuristic label", () => {
    mockDefaults();
    render(
      <LeavesPlotterCard
        boardId={10}
        sprintId={100}
        sprint={SPRINT_WITH_DATES}
        projectKey="DEV"
      />
    );
    expect(screen.getAllByText(/not a commitment/i).length).toBeGreaterThanOrEqual(1);
  });

  it("shows the capacity inputs (people · working days · leave days)", () => {
    mockDefaults();
    render(
      <LeavesPlotterCard
        boardId={10}
        sprintId={100}
        sprint={SPRINT_WITH_DATES}
        projectKey="DEV"
      />
    );
    expect(screen.getAllByText(/people/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/working day/i).length).toBeGreaterThanOrEqual(1);
  });

  it("shows velocity-based possible committed pts when baseline is available", () => {
    mockDefaults();
    render(
      <LeavesPlotterCard
        boardId={10}
        sprintId={100}
        sprint={SPRINT_WITH_DATES}
        projectKey="DEV"
      />
    );
    // avg=30, 0 leave days → 100% capacity → possible = 30
    // May appear multiple times (pts value + other contexts)
    expect(screen.getAllByText("30").length).toBeGreaterThanOrEqual(1);
  });

  it("shows 'no velocity baseline' message when no prior sprints", () => {
    vi.mocked(useJiraModule.useVelocity).mockReturnValue({
      data: { boardId: 10, sprintCount: 0, sprints: [], averageCompleted: 0, forecastNext: 0 },
      loading: false,
      error: null,
      run: vi.fn(),
    });
    // v1.8: mock useTeamMembers
    vi.mocked(useJiraModule.useTeamMembers).mockReturnValue({
      data: TEAM_MEMBERS,
      loading: false,
      error: null,
      run: vi.fn(),
      save: vi.fn().mockResolvedValue(TEAM_MEMBERS),
    });
    vi.mocked(useJiraModule.useLeaves).mockReturnValue({
      data: {},
      loading: false,
      error: null,
      run: vi.fn(),
      save: vi.fn(),
    });

    render(
      <LeavesPlotterCard
        boardId={10}
        sprintId={100}
        sprint={SPRINT_WITH_DATES}
        projectKey="DEV"
      />
    );
    expect(screen.getByText(/no velocity baseline/i)).toBeTruthy();
  });
});

// ── Tests: no-team state (v1.8) ───────────────────────────────────────────────

describe("LeavesPlotterCard — empty team roster (v1.8)", () => {
  it("shows 'No team members yet' note when team is empty", () => {
    // v1.8: empty team → note pointing to Manage team
    vi.mocked(useJiraModule.useTeamMembers).mockReturnValue({
      data: [],
      loading: false,
      error: null,
      run: vi.fn(),
      save: vi.fn().mockResolvedValue([]),
    });
    vi.mocked(useJiraModule.useVelocity).mockReturnValue({
      data: DEFAULT_VELOCITY,
      loading: false,
      error: null,
      run: vi.fn(),
    });
    vi.mocked(useJiraModule.useLeaves).mockReturnValue({
      data: {},
      loading: false,
      error: null,
      run: vi.fn(),
      save: vi.fn(),
    });

    render(
      <LeavesPlotterCard
        boardId={10}
        sprintId={100}
        sprint={SPRINT_WITH_DATES}
        projectKey="DEV"
      />
    );
    // v1.8: message now points to Manage team, not Jira project config
    expect(screen.getByText(/No team members yet/i)).toBeTruthy();
    expect(screen.getByText(/Manage team/i)).toBeTruthy();
  });
});

// ── Tests: bridge-down error (v1.8: via useTeamMembers) ──────────────────────

describe("LeavesPlotterCard — bridge-down error (v1.8)", () => {
  it("shows bridge-down error with start command and Retry button", () => {
    // v1.8: error comes from useTeamMembers (not useAssignableUsers)
    vi.mocked(useJiraModule.useTeamMembers).mockReturnValue({
      data: null,
      loading: false,
      error: { code: "BRIDGE_DOWN", message: "Cannot reach jira bridge" },
      run: vi.fn(),
      save: vi.fn(),
    });
    vi.mocked(useJiraModule.useVelocity).mockReturnValue({
      data: null,
      loading: false,
      error: null,
      run: vi.fn(),
    });
    vi.mocked(useJiraModule.useLeaves).mockReturnValue({
      data: null,
      loading: false,
      error: null,
      run: vi.fn(),
      save: vi.fn(),
    });

    render(
      <LeavesPlotterCard
        boardId={10}
        sprintId={100}
        sprint={SPRINT_WITH_DATES}
        projectKey="DEV"
      />
    );

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(/Jira bridge is offline/i)).toBeTruthy();
    expect(screen.getByText(/dev:jira:http/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Retry/i })).toBeTruthy();
  });

  it("calls run() when Retry button is clicked", () => {
    const mockRun = vi.fn();
    // v1.8: Retry calls useTeamMembers.run()
    vi.mocked(useJiraModule.useTeamMembers).mockReturnValue({
      data: null,
      loading: false,
      error: { code: "BRIDGE_DOWN", message: "Cannot reach jira bridge" },
      run: mockRun,
      save: vi.fn(),
    });
    vi.mocked(useJiraModule.useVelocity).mockReturnValue({
      data: null, loading: false, error: null, run: vi.fn(),
    });
    vi.mocked(useJiraModule.useLeaves).mockReturnValue({
      data: null, loading: false, error: null, run: vi.fn(), save: vi.fn(),
    });

    render(
      <LeavesPlotterCard
        boardId={10}
        sprintId={100}
        sprint={SPRINT_WITH_DATES}
        projectKey="DEV"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Retry/i }));
    expect(mockRun).toHaveBeenCalledOnce();
  });
});

// ── Tests: loading skeleton ───────────────────────────────────────────────────

describe("LeavesPlotterCard — loading state", () => {
  it("renders aria-busy skeleton while team roster is loading (v1.8)", () => {
    // v1.8: loading state comes from useTeamMembers
    vi.mocked(useJiraModule.useTeamMembers).mockReturnValue({
      data: null,
      loading: true,
      error: null,
      run: vi.fn(),
      save: vi.fn(),
    });
    vi.mocked(useJiraModule.useVelocity).mockReturnValue({
      data: null, loading: false, error: null, run: vi.fn(),
    });
    vi.mocked(useJiraModule.useLeaves).mockReturnValue({
      data: null, loading: false, error: null, run: vi.fn(), save: vi.fn(),
    });

    const { container } = render(
      <LeavesPlotterCard
        boardId={10}
        sprintId={100}
        sprint={SPRINT_WITH_DATES}
        projectKey="DEV"
      />
    );
    const busyEl = container.querySelector('[aria-busy="true"]');
    expect(busyEl).toBeTruthy();
  });
});
