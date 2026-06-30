// LeavesCalendarCard tests — ADR-016, v1.5
// Mocks useLeaves; no network required. Keyless/offline.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { LeavesCalendarCard } from "./LeavesCalendarCard";
import type { SprintRef, AssigneeLeaves } from "../lib/types";

// ── Mock useJira (useLeaves) ───────────────────────────────────────────────────

vi.mock("../hooks/useJira", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useJira")>();
  return {
    ...actual,
    useLeaves: vi.fn(),
  };
});

import * as useJiraModule from "../hooks/useJira";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SPRINT_WITH_DATES: SprintRef = {
  id: 42,
  name: "Sprint 7",
  state: "active",
  startDate: "2026-06-01T00:00:00.000Z", // Mon
  endDate: "2026-06-07T00:00:00.000Z",   // Sun (gives Mon–Fri working days)
  completeDate: null,
  goal: null,
  boardId: 1,
};

const SPRINT_NO_DATES: SprintRef = {
  ...SPRINT_WITH_DATES,
  startDate: null,
  endDate: null,
};

const BY_ASSIGNEE = [
  { name: "Alice", donePoints: 8, totalPoints: 13, doneCount: 1, totalCount: 2 },
  { name: "Bob", donePoints: 5, totalPoints: 10, doneCount: 1, totalCount: 2 },
];

// Default mock: loaded, no leaves recorded
function mockLeavesLoaded(leaves: Record<string, AssigneeLeaves> = {}) {
  const mockSave = vi.fn().mockResolvedValue(undefined);
  vi.mocked(useJiraModule.useLeaves).mockReturnValue({
    data: leaves,
    loading: false,
    error: null,
    run: vi.fn(),
    save: mockSave,
  });
  return mockSave;
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

// ── Tests: no-dates state ─────────────────────────────────────────────────────

describe("LeavesCalendarCard — no sprint dates", () => {
  it("shows a note when sprint has no dates", () => {
    mockLeavesLoaded();
    render(
      <LeavesCalendarCard
        sprintId={42}
        sprint={SPRINT_NO_DATES}
        byAssignee={BY_ASSIGNEE}
      />
    );
    expect(screen.getByText(/Sprint has no dates/i)).toBeTruthy();
  });
});

// ── Tests: no assignees state ─────────────────────────────────────────────────

describe("LeavesCalendarCard — no assignees", () => {
  it("shows a note when byAssignee is empty", () => {
    mockLeavesLoaded();
    render(
      <LeavesCalendarCard
        sprintId={42}
        sprint={SPRINT_WITH_DATES}
        byAssignee={[]}
      />
    );
    expect(screen.getByText(/No assignees on this sprint yet/i)).toBeTruthy();
  });
});

// ── Tests: bridge-down error ──────────────────────────────────────────────────

describe("LeavesCalendarCard — bridge-down error", () => {
  it("shows bridge-down inline error with start command and retry button", () => {
    vi.mocked(useJiraModule.useLeaves).mockReturnValue({
      data: null,
      loading: false,
      error: {
        code: "BRIDGE_DOWN",
        message: "Cannot reach jira bridge — run: npm run dev:jira:http",
      },
      run: vi.fn(),
      save: vi.fn(),
    });
    render(
      <LeavesCalendarCard
        sprintId={42}
        sprint={SPRINT_WITH_DATES}
        byAssignee={BY_ASSIGNEE}
      />
    );
    // a11y: role="alert" for the error
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(/Jira bridge is offline/i)).toBeTruthy();
    expect(screen.getByText(/dev:jira:http/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Retry/i })).toBeTruthy();
  });

  it("calls run() when Retry button is clicked", () => {
    const mockRun = vi.fn();
    vi.mocked(useJiraModule.useLeaves).mockReturnValue({
      data: null,
      loading: false,
      error: { code: "BRIDGE_DOWN", message: "Cannot reach jira bridge" },
      run: mockRun,
      save: vi.fn(),
    });
    render(
      <LeavesCalendarCard
        sprintId={42}
        sprint={SPRINT_WITH_DATES}
        byAssignee={BY_ASSIGNEE}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Retry/i }));
    expect(mockRun).toHaveBeenCalledOnce();
  });
});

// ── Tests: loading skeleton ───────────────────────────────────────────────────

describe("LeavesCalendarCard — loading state", () => {
  it("renders aria-busy skeleton while loading (no data yet)", () => {
    vi.mocked(useJiraModule.useLeaves).mockReturnValue({
      data: null,
      loading: true,
      error: null,
      run: vi.fn(),
      save: vi.fn(),
    });
    const { container } = render(
      <LeavesCalendarCard
        sprintId={42}
        sprint={SPRINT_WITH_DATES}
        byAssignee={BY_ASSIGNEE}
      />
    );
    // aria-busy="true" on the loading content
    const busyEl = container.querySelector('[aria-busy="true"]');
    expect(busyEl).toBeTruthy();
  });
});

// ── Tests: grid rendering ─────────────────────────────────────────────────────

describe("LeavesCalendarCard — grid renders from leaves data", () => {
  it("renders a table with scope headers for date columns", () => {
    mockLeavesLoaded({ Alice: { "2026-06-01": "VL" }, Bob: {} });
    const { container } = render(
      <LeavesCalendarCard
        sprintId={42}
        sprint={SPRINT_WITH_DATES}
        byAssignee={BY_ASSIGNEE}
      />
    );
    const table = container.querySelector("table");
    expect(table).toBeTruthy();
    // scope="col" headers for date columns
    const colHeaders = container.querySelectorAll('th[scope="col"]');
    // "Assignee", 5 working days (Mon–Fri in the range), "Days off"
    expect(colHeaders.length).toBeGreaterThanOrEqual(3);
  });

  it("renders a row per assignee (scope=row headers)", () => {
    mockLeavesLoaded();
    const { container } = render(
      <LeavesCalendarCard
        sprintId={42}
        sprint={SPRINT_WITH_DATES}
        byAssignee={BY_ASSIGNEE}
      />
    );
    const rowHeaders = container.querySelectorAll('th[scope="row"]');
    expect(rowHeaders.length).toBe(2); // Alice, Bob
  });

  it("renders initials avatars for assignees", () => {
    mockLeavesLoaded();
    render(
      <LeavesCalendarCard
        sprintId={42}
        sprint={SPRINT_WITH_DATES}
        byAssignee={BY_ASSIGNEE}
      />
    );
    // "AL" for Alice, "BO" for Bob
    expect(screen.getByText("AL")).toBeTruthy();
    expect(screen.getByText("BO")).toBeTruthy();
  });

  it("marks a cell as 'off' when that date is in leaves data", () => {
    mockLeavesLoaded({ Alice: { "2026-06-01": "VL" } });
    render(
      <LeavesCalendarCard
        sprintId={42}
        sprint={SPRINT_WITH_DATES}
        byAssignee={BY_ASSIGNEE}
      />
    );
    // The button for Alice on 2026-06-01 should be aria-pressed=true
    const offButtons = screen.getAllByRole("button").filter(
      (btn) => btn.getAttribute("aria-pressed") === "true"
    );
    expect(offButtons.length).toBe(1);
  });

  it("renders the leave-type abbreviation inside cells that are marked off", () => {
    mockLeavesLoaded({ Alice: { "2026-06-01": "VL" } });
    render(
      <LeavesCalendarCard
        sprintId={42}
        sprint={SPRINT_WITH_DATES}
        byAssignee={BY_ASSIGNEE}
      />
    );
    // The pressed button shows the leave type abbreviation (VL).
    const pressedBtn = screen.getAllByRole("button").find(
      (btn) => btn.getAttribute("aria-pressed") === "true"
    );
    expect(pressedBtn?.textContent).toBe("VL");
  });

  it("shows the correct leave days count in the row totals column", () => {
    mockLeavesLoaded({ Alice: { "2026-06-01": "VL", "2026-06-02": "VL" } }); // 2 working days
    render(
      <LeavesCalendarCard
        sprintId={42}
        sprint={SPRINT_WITH_DATES}
        byAssignee={BY_ASSIGNEE}
      />
    );
    // Alice has 2 leave days
    expect(screen.getByText("2")).toBeTruthy();
  });
});

// ── Tests: toggle interaction ─────────────────────────────────────────────────

describe("LeavesCalendarCard — toggle calls save", () => {
  it("calls save(assignee, newDates) when a non-off cell is clicked", async () => {
    const mockSave = mockLeavesLoaded({ Alice: {} }); // Alice has no leaves
    render(
      <LeavesCalendarCard
        sprintId={42}
        sprint={SPRINT_WITH_DATES}
        byAssignee={[{ name: "Alice" }]}
      />
    );

    // Click the first un-pressed toggle for Alice (any working day)
    const unPressed = screen.getAllByRole("button").find(
      (btn) => btn.getAttribute("aria-pressed") === "false"
    );
    expect(unPressed).toBeTruthy();
    if (unPressed) {
      fireEvent.click(unPressed);
    }

    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledOnce();
    });

    // The call should be save("Alice", ["2026-06-01"]) — first working day
    expect(mockSave).toHaveBeenCalledWith("Alice", expect.any(Array));
    const [name, dates] = mockSave.mock.calls[0];
    expect(name).toBe("Alice");
    expect(dates.length).toBeGreaterThan(0);
  });

  it("calls save(assignee, datesWithoutDay) when an off cell is clicked (toggle off)", async () => {
    const mockSave = mockLeavesLoaded({ Alice: { "2026-06-01": "VL" } });
    render(
      <LeavesCalendarCard
        sprintId={42}
        sprint={SPRINT_WITH_DATES}
        byAssignee={[{ name: "Alice" }]}
      />
    );

    // Click the pressed toggle
    const pressedBtn = screen.getAllByRole("button").find(
      (btn) => btn.getAttribute("aria-pressed") === "true"
    );
    expect(pressedBtn).toBeTruthy();
    if (pressedBtn) {
      fireEvent.click(pressedBtn);
    }

    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledOnce();
    });

    // After removing, dates should be empty
    const [name, dates] = mockSave.mock.calls[0];
    expect(name).toBe("Alice");
    expect(dates).toEqual([]);
  });

  it("toggle buttons have descriptive accessible names (aria-label)", () => {
    mockLeavesLoaded({ Alice: { "2026-06-01": "VL" } });
    render(
      <LeavesCalendarCard
        sprintId={42}
        sprint={SPRINT_WITH_DATES}
        byAssignee={[{ name: "Alice" }]}
      />
    );
    // All toggle buttons should have an aria-label
    const buttons = screen.getAllByRole("button");
    for (const btn of buttons) {
      expect(btn.getAttribute("aria-label")).toBeTruthy();
    }
  });
});

// ── Tests: readOnly mode (v1.7, ADR-018) ─────────────────────────────────────

describe("LeavesCalendarCard — readOnly mode (Reports, v1.7)", () => {
  it("renders NO toggle buttons when readOnly=true", () => {
    mockLeavesLoaded({ Alice: { "2026-06-01": "VL" } });
    render(
      <LeavesCalendarCard
        sprintId={42}
        sprint={SPRINT_WITH_DATES}
        byAssignee={BY_ASSIGNEE}
        readOnly
      />
    );
    // No interactive buttons in the grid (the Retry button won't appear either)
    const buttons = screen.queryAllByRole("button");
    expect(buttons.length).toBe(0);
  });

  it("shows the leave-type abbreviation for leave days in readOnly mode", () => {
    mockLeavesLoaded({ Alice: { "2026-06-01": "VL" } });
    render(
      <LeavesCalendarCard
        sprintId={42}
        sprint={SPRINT_WITH_DATES}
        byAssignee={BY_ASSIGNEE}
        readOnly
      />
    );
    // The leave type abbreviation (VL) should appear as a static span.
    expect(screen.getByText("VL")).toBeTruthy();
  });

  it("renders the Leaves column with leave counts (data still shown)", () => {
    mockLeavesLoaded({ Alice: { "2026-06-01": "VL", "2026-06-02": "VL" }, Bob: {} });
    render(
      <LeavesCalendarCard
        sprintId={42}
        sprint={SPRINT_WITH_DATES}
        byAssignee={BY_ASSIGNEE}
        readOnly
      />
    );
    // Alice has 2 leave days shown in totals column
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("still renders the table with scope headers in readOnly mode", () => {
    mockLeavesLoaded();
    const { container } = render(
      <LeavesCalendarCard
        sprintId={42}
        sprint={SPRINT_WITH_DATES}
        byAssignee={BY_ASSIGNEE}
        readOnly
      />
    );
    const table = container.querySelector("table");
    expect(table).toBeTruthy();
    const colHeaders = container.querySelectorAll('th[scope="col"]');
    expect(colHeaders.length).toBeGreaterThanOrEqual(3);
  });
});

// ── Tests: assignees prop (v1.7) ──────────────────────────────────────────────

describe("LeavesCalendarCard — explicit assignees prop (v1.7)", () => {
  it("uses explicit assignees prop instead of byAssignee", () => {
    mockLeavesLoaded();
    const { container } = render(
      <LeavesCalendarCard
        sprintId={42}
        sprint={SPRINT_WITH_DATES}
        assignees={["Carol", "Dave"]}
      />
    );
    const rowHeaders = container.querySelectorAll('th[scope="row"]');
    expect(rowHeaders.length).toBe(2);
    expect(screen.getByText("Carol")).toBeTruthy();
    expect(screen.getByText("Dave")).toBeTruthy();
  });

  it("assignees prop takes precedence when both assignees and byAssignee are given", () => {
    mockLeavesLoaded();
    const { container } = render(
      <LeavesCalendarCard
        sprintId={42}
        sprint={SPRINT_WITH_DATES}
        assignees={["Carol"]}
        byAssignee={BY_ASSIGNEE} // Alice, Bob — should be ignored
      />
    );
    const rowHeaders = container.querySelectorAll('th[scope="row"]');
    // Only Carol (1 row)
    expect(rowHeaders.length).toBe(1);
    expect(screen.getByText("Carol")).toBeTruthy();
    expect(screen.queryByText("Alice")).toBeNull();
  });
});

// ── Tests: onLeavesChange callback ───────────────────────────────────────────

describe("LeavesCalendarCard — onLeavesChange", () => {
  it("calls onLeavesChange with per-assignee leave day counts when data loads", async () => {
    const onLeavesChange = vi.fn();
    mockLeavesLoaded({ Alice: { "2026-06-01": "VL", "2026-06-02": "VL" }, Bob: {} });
    render(
      <LeavesCalendarCard
        sprintId={42}
        sprint={SPRINT_WITH_DATES}
        byAssignee={BY_ASSIGNEE}
        onLeavesChange={onLeavesChange}
      />
    );
    await waitFor(() => {
      expect(onLeavesChange).toHaveBeenCalled();
    });
    const lastCall = onLeavesChange.mock.calls[onLeavesChange.mock.calls.length - 1][0];
    expect(lastCall.Alice).toBe(2);
    expect(lastCall.Bob).toBe(0);
  });
});
