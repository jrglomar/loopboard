// Planning page tests — v1.7 (ADR-018)
// Keyless/offline — all hooks and boards mocked.
//
// Tests:
// - Board toggle renders (Dev/PO)
// - Sprint target defaults to first future sprint (then active if no future)
// - New Sprint dialog is present
// - TicketGen renders inside Planning
// - Board change re-defaults the sprint target

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { Planning } from "./Planning";

// ── Mocks (ALL vi.mock calls hoisted; do NOT reference variables here) ─────────

// Mock boards — boards loaded with dev+po ids
vi.mock("../lib/boards", () => ({
  useBoards: vi.fn().mockReturnValue({
    boards: { dev: { id: 10, projectKey: "DEV" }, po: { id: 20, projectKey: "PO" } },
    loading: false,
  }),
  getBoards: vi.fn().mockResolvedValue(
    { dev: { id: 10, projectKey: "DEV" }, po: { id: 20, projectKey: "PO" } }
  ),
}));

// Mock useSprintList: inline sprint data — no const references allowed at hoist level
vi.mock("../hooks/useJira", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useJira")>();
  return {
    ...actual,
    useSprintList: vi.fn().mockReturnValue({
      data: {
        boardId: 10,
        active: [
          {
            id: 55,
            name: "Sprint 7 (Active)",
            state: "active",
            startDate: "2026-06-14T00:00:00.000Z",
            endDate: "2026-06-27T00:00:00.000Z",
            completeDate: null,
            goal: null,
            boardId: 10,
          },
        ],
        future: [
          {
            id: 100,
            name: "Sprint 8 (Future)",
            state: "future",
            startDate: "2026-06-28T00:00:00.000Z",
            endDate: "2026-07-11T00:00:00.000Z",
            completeDate: null,
            goal: "Ship the planning feature",
            boardId: 10,
          },
        ],
        closed: [],
      },
      loading: false,
      error: null,
      run: vi.fn(),
    }),
    createSprint: vi.fn(),
  };
});

// Mock CreateSprintDialog — simple testable placeholder
vi.mock("../components/CreateSprintDialog", () => ({
  CreateSprintDialog: ({
    boardId,
    onSuccess,
  }: {
    boardId?: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onSuccess: (s: any) => void;
  }) => (
    <div
      data-testid="create-sprint-dialog"
      data-board-id={boardId}
    >
      <button
        type="button"
        onClick={() =>
          onSuccess({
            id: 100,
            name: "Sprint 8 (Future)",
            state: "future",
            startDate: "2026-06-28T00:00:00.000Z",
            endDate: "2026-07-11T00:00:00.000Z",
            completeDate: null,
            goal: "Ship the planning feature",
            boardId: boardId ?? 10,
          })
        }
        data-testid="create-sprint-trigger"
      >
        New Sprint
      </button>
    </div>
  ),
}));

// Mock TicketGen — verify it receives the pre-seed props from Planning context
vi.mock("./TicketGen", () => ({
  TicketGen: ({
    initialPoSprintId,
    initialDevSprintId,
  }: {
    initialPoSprintId?: number;
    initialDevSprintId?: number;
  }) => (
    <div
      data-testid="ticket-gen"
      data-initial-po-sprint-id={initialPoSprintId ?? ""}
      data-initial-dev-sprint-id={initialDevSprintId ?? ""}
    >
      Ticket Gen
    </div>
  ),
}));

// Mock LeavesPlotterCard — verify it receives the right props
vi.mock("../components/LeavesPlotterCard", () => ({
  LeavesPlotterCard: ({
    boardId,
    sprintId,
    projectKey,
  }: {
    boardId?: number;
    sprintId?: number | null;
    projectKey?: string;
    sprint?: unknown;
  }) => (
    <div
      data-testid="leaves-plotter-card"
      data-board-id={boardId ?? ""}
      data-sprint-id={sprintId ?? ""}
      data-project-key={projectKey ?? ""}
    >
      Leaves Plotter
    </div>
  ),
}));

// Mock AssignmentList — verify it receives the right props
vi.mock("../components/AssignmentList", () => ({
  AssignmentList: ({
    boardId,
    sprintId,
    projectKey,
  }: {
    boardId?: number;
    sprintId?: number | null;
    projectKey?: string;
  }) => (
    <div
      data-testid="assignment-list"
      data-board-id={boardId ?? ""}
      data-sprint-id={sprintId ?? ""}
      data-project-key={projectKey ?? ""}
    >
      Assignment List
    </div>
  ),
}));

// Mock BoardToggle to get clean button roles in tests
vi.mock("../components/BoardToggle", () => ({
  BoardToggle: ({
    selectedKey,
    onChange,
  }: {
    selectedKey: string;
    onChange: (key: "dev" | "po") => void;
  }) => (
    <div
      role="group"
      aria-label="Board"
      data-testid="board-toggle"
    >
      <button
        type="button"
        aria-pressed={selectedKey === "dev"}
        onClick={() => onChange("dev")}
      >
        Dev
      </button>
      <button
        type="button"
        aria-pressed={selectedKey === "po"}
        onClick={() => onChange("po")}
      >
        PO
      </button>
    </div>
  ),
}));

// ── Import mocked modules ─────────────────────────────────────────────────────
import * as boardsModule from "../lib/boards";
import * as useJiraModule from "../hooks/useJira";

// ── Fixtures (declared AFTER vi.mock; only used in test bodies) ───────────────

const FUTURE_SPRINT_ID = 100;
const ACTIVE_SPRINT_ID = 55;

const DEFAULT_SPRINT_LIST = {
  boardId: 10,
  active: [
    {
      id: ACTIVE_SPRINT_ID,
      name: "Sprint 7 (Active)",
      state: "active" as const,
      startDate: "2026-06-14T00:00:00.000Z",
      endDate: "2026-06-27T00:00:00.000Z",
      completeDate: null,
      goal: null,
      boardId: 10,
    },
  ],
  future: [
    {
      id: FUTURE_SPRINT_ID,
      name: "Sprint 8 (Future)",
      state: "future" as const,
      startDate: "2026-06-28T00:00:00.000Z",
      endDate: "2026-07-11T00:00:00.000Z",
      completeDate: null,
      goal: "Ship the planning feature",
      boardId: 10,
    },
  ],
  closed: [],
};

const NO_FUTURE_SPRINT_LIST = {
  boardId: 10,
  active: DEFAULT_SPRINT_LIST.active,
  future: [],
  closed: [],
};

// ── Setup/teardown ────────────────────────────────────────────────────────────

function setDefaultMocks() {
  vi.mocked(boardsModule.useBoards).mockReturnValue({
    boards: { dev: { id: 10, projectKey: "DEV" }, po: { id: 20, projectKey: "PO" } },
    loading: false,
  });
  vi.mocked(useJiraModule.useSprintList).mockReturnValue({
    data: DEFAULT_SPRINT_LIST,
    loading: false,
    error: null,
    run: vi.fn(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setDefaultMocks();
});

afterEach(() => {
  cleanup();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Planning — board toggle (v1.7, ADR-018)", () => {
  it("renders the board toggle (Dev/PO)", async () => {
    render(<Planning />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Dev" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "PO" })).toBeTruthy();
    });
  });

  it("Dev board is pressed by default", async () => {
    render(<Planning />);
    await waitFor(() => {
      const devBtn = screen.getByRole("button", { name: "Dev" });
      expect(devBtn.getAttribute("aria-pressed")).toBe("true");
    });
    const poBtn = screen.getByRole("button", { name: "PO" });
    expect(poBtn.getAttribute("aria-pressed")).toBe("false");
  });

  it("does NOT render the board toggle while boards is loading", () => {
    vi.mocked(boardsModule.useBoards).mockReturnValue({
      boards: null,
      loading: true,
    });
    render(<Planning />);
    // Board toggle not yet present during load
    expect(screen.queryByRole("button", { name: "Dev" })).toBeNull();
    expect(screen.queryByRole("button", { name: "PO" })).toBeNull();
  });
});

describe("Planning — default sprint target (v1.7, ADR-018)", () => {
  it("defaults to the first future sprint when available", async () => {
    render(<Planning />);
    await waitFor(() => {
      const select = screen.getByRole("combobox", { name: /planning target/i });
      // The value should match the future sprint id
      expect((select as HTMLSelectElement).value).toBe(String(FUTURE_SPRINT_ID));
    });
  });

  it("defaults to the active sprint when no future sprint exists", async () => {
    vi.mocked(useJiraModule.useSprintList).mockReturnValue({
      data: NO_FUTURE_SPRINT_LIST,
      loading: false,
      error: null,
      run: vi.fn(),
    });
    render(<Planning />);
    await waitFor(() => {
      const select = screen.getByRole("combobox", { name: /planning target/i });
      // Falls back to the first active sprint
      expect((select as HTMLSelectElement).value).toBe(String(ACTIVE_SPRINT_ID));
    });
  });

  it("shows 'Future sprint' badge when a future sprint is selected", async () => {
    render(<Planning />);
    await waitFor(() => {
      expect(screen.getByText(/future sprint/i)).toBeTruthy();
    });
  });

  it("shows the sprint goal when available", async () => {
    render(<Planning />);
    await waitFor(() => {
      // FUTURE_SPRINT.goal = "Ship the planning feature"
      expect(screen.getByText("Ship the planning feature")).toBeTruthy();
    });
  });
});

describe("Planning — New Sprint dialog (v1.7, ADR-018)", () => {
  it("renders the CreateSprintDialog in the Planning header", async () => {
    render(<Planning />);
    await waitFor(() => {
      expect(screen.getByTestId("create-sprint-dialog")).toBeTruthy();
    });
  });

  it("passes the selected Dev board id to CreateSprintDialog by default", async () => {
    render(<Planning />);
    await waitFor(() => {
      const dialog = screen.getByTestId("create-sprint-dialog");
      // Dev board id = 10
      expect(dialog.getAttribute("data-board-id")).toBe("10");
    });
  });

  it("selecting a new sprint via CreateSprintDialog updates the target and refetches", async () => {
    const mockRun = vi.fn();
    vi.mocked(useJiraModule.useSprintList).mockReturnValue({
      data: DEFAULT_SPRINT_LIST,
      loading: false,
      error: null,
      run: mockRun,
    });

    render(<Planning />);
    await waitFor(() => screen.getByTestId("create-sprint-trigger"));

    // Simulate the user clicking "New Sprint" via the mock trigger
    fireEvent.click(screen.getByTestId("create-sprint-trigger"));

    await waitFor(() => {
      // After onSuccess, the sprint list run() should be called to refetch
      expect(mockRun).toHaveBeenCalled();
    });
  });
});

describe("Planning — TicketGen embedded (v1.7, ADR-018)", () => {
  it("renders TicketGen inside the Planning page", async () => {
    render(<Planning />);
    // v1.17 (ADR-028): TicketGen is behind the "New ticket" drawer.
    fireEvent.click(screen.getByRole("button", { name: /New ticket/i }));
    await waitFor(() => {
      expect(screen.getByTestId("ticket-gen")).toBeTruthy();
    });
  });

  it("pre-seeds TicketGen with the Dev sprint id when Dev board is selected", async () => {
    render(<Planning />);
    fireEvent.click(screen.getByRole("button", { name: /New ticket/i }));
    await waitFor(() => {
      const ticketGen = screen.getByTestId("ticket-gen");
      // Dev board is default; planned sprint = FUTURE_SPRINT_ID = 100
      expect(ticketGen.getAttribute("data-initial-dev-sprint-id")).toBe(
        String(FUTURE_SPRINT_ID)
      );
      // PO sprint NOT pre-seeded when Dev board is selected
      expect(ticketGen.getAttribute("data-initial-po-sprint-id")).toBe("");
    });
  });

  it("pre-seeds TicketGen with the PO sprint id when PO board is selected", async () => {
    const poSprintId = 200;
    vi.mocked(useJiraModule.useSprintList).mockReturnValue({
      data: {
        boardId: 20,
        active: [],
        future: [
          {
            id: poSprintId,
            name: "PO Sprint 3",
            state: "future" as const,
            startDate: "2026-06-28T00:00:00.000Z",
            endDate: "2026-07-11T00:00:00.000Z",
            completeDate: null,
            goal: null,
            boardId: 20,
          },
        ],
        closed: [],
      },
      loading: false,
      error: null,
      run: vi.fn(),
    });

    render(<Planning />);
    await waitFor(() => screen.getByRole("button", { name: "PO" }));

    fireEvent.click(screen.getByRole("button", { name: "PO" }));
    fireEvent.click(screen.getByRole("button", { name: /New ticket/i }));

    await waitFor(() => {
      const ticketGen = screen.getByTestId("ticket-gen");
      // PO sprint pre-seeded; Dev sprint not seeded
      expect(ticketGen.getAttribute("data-initial-po-sprint-id")).toBe(String(poSprintId));
      expect(ticketGen.getAttribute("data-initial-dev-sprint-id")).toBe("");
    });
  });
});

describe("Planning — LeavesPlotterCard slot (v1.7, ADR-018)", () => {
  it("renders LeavesPlotterCard with correct boardId and projectKey", async () => {
    render(<Planning />);
    await waitFor(() => screen.getByTestId("leaves-plotter-card"));
    const card = screen.getByTestId("leaves-plotter-card");
    // Dev board (id=10) + DEV project key
    expect(card.getAttribute("data-board-id")).toBe("10");
    expect(card.getAttribute("data-project-key")).toBe("DEV");
  });

  it("passes the planned sprintId to LeavesPlotterCard", async () => {
    render(<Planning />);
    await waitFor(() => screen.getByTestId("leaves-plotter-card"));
    const card = screen.getByTestId("leaves-plotter-card");
    // Default target = FUTURE_SPRINT_ID = 100
    expect(card.getAttribute("data-sprint-id")).toBe(String(FUTURE_SPRINT_ID));
  });
});

describe("Planning — AssignmentList slot (v1.7, ADR-018)", () => {
  it("renders AssignmentList with correct boardId and projectKey", async () => {
    render(<Planning />);
    await waitFor(() => screen.getByTestId("assignment-list"));
    const list = screen.getByTestId("assignment-list");
    expect(list.getAttribute("data-board-id")).toBe("10");
    expect(list.getAttribute("data-project-key")).toBe("DEV");
  });

  it("passes the planned sprintId to AssignmentList", async () => {
    render(<Planning />);
    await waitFor(() => screen.getByTestId("assignment-list"));
    const list = screen.getByTestId("assignment-list");
    expect(list.getAttribute("data-sprint-id")).toBe(String(FUTURE_SPRINT_ID));
  });

  it("updates AssignmentList sprintId when sprint picker changes", async () => {
    render(<Planning />);
    await waitFor(() => screen.getByTestId("assignment-list"));

    // Change the sprint picker to the active sprint
    const select = screen.getByRole("combobox", { name: /planning target/i });
    fireEvent.change(select, { target: { value: String(ACTIVE_SPRINT_ID) } });

    await waitFor(() => {
      const list = screen.getByTestId("assignment-list");
      expect(list.getAttribute("data-sprint-id")).toBe(String(ACTIVE_SPRINT_ID));
    });
  });
});

describe("Planning — board change re-defaults sprint target (v1.7, ADR-018)", () => {
  it("switching to PO board re-defaults the sprint picker to the PO future sprint", async () => {
    const poSprintId = 201;
    vi.mocked(useJiraModule.useSprintList).mockReturnValue({
      data: {
        boardId: 20,
        active: [],
        future: [
          {
            id: poSprintId,
            name: "PO Sprint Future",
            state: "future" as const,
            startDate: "2026-06-28T00:00:00.000Z",
            endDate: "2026-07-11T00:00:00.000Z",
            completeDate: null,
            goal: null,
            boardId: 20,
          },
        ],
        closed: [],
      },
      loading: false,
      error: null,
      run: vi.fn(),
    });

    render(<Planning />);
    await waitFor(() => screen.getByRole("button", { name: "PO" }));
    fireEvent.click(screen.getByRole("button", { name: "PO" }));

    await waitFor(() => {
      const select = screen.getByRole("combobox", { name: /planning target/i });
      expect((select as HTMLSelectElement).value).toBe(String(poSprintId));
    });
  });
});
