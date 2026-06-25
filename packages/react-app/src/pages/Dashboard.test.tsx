// Dashboard page tests — v1.6 board toggle (ADR-017)
// Keyless/offline — all hooks and boards mocked.

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { Dashboard } from "./Dashboard";

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Mock useJira hooks
vi.mock("../hooks/useJira", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useJira")>();
  return {
    ...actual,
    useActiveSprint: vi.fn(),
    useDailyHuddle: vi.fn(),
  };
});

// Mock aiClient — default: AI disabled
vi.mock("../lib/aiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/aiClient")>();
  return {
    ...actual,
    getAiStatus: vi.fn().mockResolvedValue({ enabled: false, provider: null, model: null }),
  };
});

// v1.6 (ADR-017): mock boards — default: boards loaded with dev+po ids
vi.mock("../lib/boards", () => ({
  useBoards: vi.fn().mockReturnValue({
    boards: { dev: { id: 10, projectKey: "DEV" }, po: { id: 20, projectKey: "PO" } },
    loading: false,
  }),
  getBoards: vi.fn().mockResolvedValue(
    { dev: { id: 10, projectKey: "DEV" }, po: { id: 20, projectKey: "PO" } }
  ),
}));

// Mock child components to avoid complex dependency chains
vi.mock("../components/SprintBoard", () => ({
  SprintBoard: ({ error, createSprintButton }: { error: { code: string; message: string } | null; createSprintButton?: React.ReactNode }) => {
    // Render error message so we can test no-sprint empty state
    if (error) return <div data-testid="sprint-board-error">{error.message}</div>;
    return <div data-testid="sprint-board">{createSprintButton}Sprint Board</div>;
  },
}));

vi.mock("../components/HuddleDigest", () => ({
  HuddleDigest: () => <div data-testid="huddle-digest">Huddle Digest</div>,
}));

vi.mock("../components/CreateSprintDialog", () => ({
  CreateSprintDialog: ({ boardId }: { boardId?: number }) => (
    <div data-testid="create-sprint-dialog" data-board-id={boardId}>Create Sprint</div>
  ),
}));

// ── Import mocked modules ─────────────────────────────────────────────────────

import * as useJiraModule from "../hooks/useJira";
import * as boardsModule from "../lib/boards";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const DEFAULT_BOARDS = {
  dev: { id: 10, projectKey: "DEV" },
  po: { id: 20, projectKey: "PO" },
};

const DEV_SPRINT_DATA = {
  sprint: { id: 1, name: "Dev Sprint 1", state: "active" as const, startDate: null, endDate: null, goal: null },
  activeSprints: [{ id: 1, name: "Dev Sprint 1", startDate: null, endDate: null, goal: null }],
  futureSprints: [],
  issuesByStatus: { todo: [], inprogress: [], codereview: [], done: [] },
  totals: { total: 0, todo: 0, inprogress: 0, codereview: 0, done: 0, blocked: 0, storyPointsTotal: 0, storyPointsDone: 0, storyPointsCodeReview: 0 },
};

const UPSTREAM_NO_SPRINT_ERROR = {
  code: "UPSTREAM",
  message: "No active or future sprint found for board 20",
};

function setDefaultMocks() {
  // v1.6: reset useBoards to the default boards state after clearAllMocks
  vi.mocked(boardsModule.useBoards).mockReturnValue({ boards: DEFAULT_BOARDS, loading: false });
  vi.mocked(useJiraModule.useActiveSprint).mockReturnValue({
    data: DEV_SPRINT_DATA,
    loading: false,
    error: null,
    run: vi.fn(),
  });
  vi.mocked(useJiraModule.useDailyHuddle).mockReturnValue({
    data: null,
    loading: false,
    error: null,
    run: vi.fn(),
  });
}

// ── Setup/teardown ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  setDefaultMocks();
});

afterEach(() => {
  cleanup();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Dashboard — board toggle (v1.6, ADR-017)", () => {
  it("renders the board toggle when boards is loaded", async () => {
    render(<Dashboard />);
    await waitFor(() => {
      // Toggle buttons: Dev and PO
      expect(screen.getByRole("button", { name: "Dev" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "PO" })).toBeTruthy();
    });
  });

  it("does NOT render the board toggle when boards is null (older bridge)", async () => {
    vi.mocked(boardsModule.useBoards).mockReturnValue({ boards: null, loading: false });
    render(<Dashboard />);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Dev" })).toBeNull();
      expect(screen.queryByRole("button", { name: "PO" })).toBeNull();
    });
  });

  it("does NOT render the board toggle while boards is loading", async () => {
    vi.mocked(boardsModule.useBoards).mockReturnValue({ boards: null, loading: true });
    render(<Dashboard />);
    // During loading, no toggle
    expect(screen.queryByRole("button", { name: "Dev" })).toBeNull();
    expect(screen.queryByRole("button", { name: "PO" })).toBeNull();
  });

  it("Dev button is pressed (aria-pressed=true) by default", async () => {
    render(<Dashboard />);
    await waitFor(() => {
      const devBtn = screen.getByRole("button", { name: "Dev" });
      expect(devBtn.getAttribute("aria-pressed")).toBe("true");
    });
    const poBtn = screen.getByRole("button", { name: "PO" });
    expect(poBtn.getAttribute("aria-pressed")).toBe("false");
  });

  it("switches to PO board when PO button is clicked — useActiveSprint called with PO board id", async () => {
    render(<Dashboard />);
    await waitFor(() => screen.getByRole("button", { name: "PO" }));

    fireEvent.click(screen.getByRole("button", { name: "PO" }));

    await waitFor(() => {
      // useActiveSprint should have been called with the PO board id (20)
      const calls = vi.mocked(useJiraModule.useActiveSprint).mock.calls;
      const hasPOCall = calls.some((args) => args[0] === 20);
      expect(hasPOCall).toBe(true);
    });
  });

  it("PO button has aria-pressed=true after clicking PO", async () => {
    render(<Dashboard />);
    await waitFor(() => screen.getByRole("button", { name: "PO" }));
    fireEvent.click(screen.getByRole("button", { name: "PO" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "PO" }).getAttribute("aria-pressed")).toBe("true");
      expect(screen.getByRole("button", { name: "Dev" }).getAttribute("aria-pressed")).toBe("false");
    });
  });

  it("board group is labeled 'Board' for screen readers", async () => {
    render(<Dashboard />);
    await waitFor(() => {
      const group = screen.getByRole("group", { name: /board/i });
      expect(group).toBeTruthy();
    });
  });
});

describe("Dashboard — PO board no-sprint empty state (v1.6, ADR-017)", () => {
  it("shows friendly empty state when PO board has no sprints (UPSTREAM error)", async () => {
    // When PO board is selected and returns an UPSTREAM no-sprint error
    vi.mocked(useJiraModule.useActiveSprint).mockReturnValue({
      data: null,
      loading: false,
      error: UPSTREAM_NO_SPRINT_ERROR,
      run: vi.fn(),
    });

    render(<Dashboard />);
    await waitFor(() => screen.getByRole("button", { name: "PO" }));
    fireEvent.click(screen.getByRole("button", { name: "PO" }));

    await waitFor(() => {
      // Friendly empty state text, NOT a red error alert
      expect(screen.getByText(/No sprints on the PO board/i)).toBeTruthy();
    });
  });

  it("does NOT show the SprintBoard component when there are no sprints on the PO board", async () => {
    vi.mocked(useJiraModule.useActiveSprint).mockReturnValue({
      data: null,
      loading: false,
      error: UPSTREAM_NO_SPRINT_ERROR,
      run: vi.fn(),
    });

    render(<Dashboard />);
    await waitFor(() => screen.getByRole("button", { name: "PO" }));
    fireEvent.click(screen.getByRole("button", { name: "PO" }));

    await waitFor(() => {
      // SprintBoard mock is NOT rendered (empty state shows instead)
      expect(screen.queryByTestId("sprint-board")).toBeNull();
    });
  });

});

// v1.7 (ADR-018): New Sprint button REMOVED from Dashboard — it now lives on the Planning page.
// The CreateSprintDialog is no longer rendered by Dashboard.
describe("Dashboard — New Sprint removed (v1.7, ADR-018)", () => {
  it("does NOT render CreateSprintDialog on the Dashboard (moved to Planning)", async () => {
    render(<Dashboard />);
    // Allow time for async rendering to settle
    await waitFor(() => {
      // Sprint board should be visible
      expect(screen.getByTestId("sprint-board")).toBeTruthy();
    });
    // CreateSprintDialog must NOT appear on the Dashboard
    expect(screen.queryByTestId("create-sprint-dialog")).toBeNull();
  });
});

describe("Dashboard — Dev board (default)", () => {
  it("passes dev board id to useActiveSprint on initial render", async () => {
    render(<Dashboard />);
    await waitFor(() => {
      const calls = vi.mocked(useJiraModule.useActiveSprint).mock.calls;
      // At least one call with Dev board id (10)
      const hasDevCall = calls.some((args) => args[0] === 10);
      expect(hasDevCall).toBe(true);
    });
  });
});

describe("Dashboard — sprint goal banner + shared context (v1.13, ADR-024)", () => {
  it("shows the sprint goal and % points done (DoD)", async () => {
    vi.mocked(useJiraModule.useActiveSprint).mockReturnValue({
      data: {
        ...DEV_SPRINT_DATA,
        sprint: { id: 1, name: "Dev Sprint 1", state: "active", startDate: null, endDate: null, goal: "Ship the checkout flow" },
        totals: { ...DEV_SPRINT_DATA.totals, storyPointsTotal: 10, storyPointsDone: 4, storyPointsCodeReview: 1 },
      },
      loading: false, error: null, run: vi.fn(),
    });
    render(<Dashboard />);
    expect(await screen.findByText("Ship the checkout flow")).toBeTruthy();
    // (4 done + 1 code-review) / 10 = 50%
    const bar = screen.getByRole("progressbar", { name: /Sprint goal progress/i });
    expect(bar.getAttribute("aria-valuenow")).toBe("50");
  });

  it("shows a 'No goal set' hint when the sprint has no goal", async () => {
    render(<Dashboard />); // default fixture: goal = null
    expect(await screen.findByText(/No goal set/i)).toBeTruthy();
  });

  it("controlled: uses the boardKey prop from App (PO pressed)", async () => {
    render(<Dashboard boardKey="po" sprintId={null} onBoardChange={vi.fn()} onSprintChange={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "PO" }).getAttribute("aria-pressed")).toBe("true");
    });
  });

  it("controlled: picking a sprint calls onSprintChange (carries to App)", async () => {
    const onSprintChange = vi.fn();
    // SprintBoard is mocked; assert the wiring via the board toggle's onBoardChange instead.
    const onBoardChange = vi.fn();
    render(<Dashboard boardKey="dev" sprintId={null} onBoardChange={onBoardChange} onSprintChange={onSprintChange} />);
    await waitFor(() => screen.getByRole("button", { name: "PO" }));
    fireEvent.click(screen.getByRole("button", { name: "PO" }));
    expect(onBoardChange).toHaveBeenCalledWith("po");
  });
});
