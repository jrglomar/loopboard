// Leaves page tests — v1.26 (ADR-038) + forward planner v1.29 (ADR-041). Keyless/offline (hooks mocked).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Leaves } from "./Leaves";

// Hoisted so the vi.mock factories below (also hoisted) can reference it.
const { SPRINT } = vi.hoisted(() => ({
  SPRINT: {
    id: 1, name: "Sprint 1", state: "active",
    startDate: "2026-06-01", endDate: "2026-06-05", completeDate: null, goal: null, boardId: 10,
  },
}));

vi.mock("../lib/boards", () => ({
  useBoards: vi.fn().mockReturnValue({
    boards: { dev: [{ id: 10, projectKey: "DEV" }], po: [{ id: 20, projectKey: "PO" }] },
    loading: false,
  }),
  usePolicy: vi.fn().mockReturnValue({ requiredPoints: 8, offsetThreshold: 2 }),
}));

vi.mock("../hooks/useJira", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useJira")>();
  return {
    ...actual,
    useSprintList: vi.fn().mockReturnValue({
      data: { boardId: 10, active: [SPRINT], future: [], closed: [] }, loading: false, error: null, run: vi.fn(),
    }),
    useSprintReport: vi.fn().mockReturnValue({
      data: { sprint: SPRINT, byAssignee: [{ name: "Alice", donePoints: 8, totalPoints: 8, doneCount: 1, totalCount: 1 }] },
      loading: false, error: null, run: vi.fn(),
    }),
    useTeamMembers: vi.fn().mockReturnValue({
      data: [{ accountId: "u1", displayName: "Alice" }], loading: false, error: null, run: vi.fn(), save: vi.fn(),
    }),
    // v1.29: the whole store keyed by sprint id. Alice in sprint 1: 1 Offset + 1 VL → 2 leave days.
    useAllLeaves: vi.fn().mockReturnValue({
      data: { "1": { Alice: { "2026-06-02": "Offset", "2026-06-03": "VL" } } },
      loading: false, error: null, run: vi.fn(), save: vi.fn(),
    }),
    useOffsetLedger: vi.fn().mockReturnValue({
      data: { Alice: { earned: 1, spent: 1, manualAdjust: 0, balance: 0 } },
      loading: false, error: null, run: vi.fn(), recordSprint: vi.fn(), adjust: vi.fn(),
    }),
  };
});

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe("Leaves page (v1.26)", () => {
  it("renders the leave-type painter and the policy chips", () => {
    render(<Leaves />);
    expect(screen.getByRole("button", { name: "Vacation" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Emergency" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Holiday" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Offset" })).toBeTruthy();
    expect(screen.getByText(/Required N/)).toBeTruthy();
  });

  it("computes the offset row: done 8 + 2 leave days = total 10 → earned +1", () => {
    render(<Leaves />);
    // "Alice" appears in both the calendar grid and the offset table → ≥1.
    expect(screen.getAllByText("Alice").length).toBeGreaterThan(0);
    expect(screen.getByText("10")).toBeTruthy(); // total (8 done + 2 leaves) — unique to the offset table
    expect(screen.getByText("+1")).toBeTruthy(); // earned this sprint
  });

  it("shows the earn-rule caption", () => {
    render(<Leaves />);
    expect(screen.getByText(/Earned = \(done \+ leave days\)/)).toBeTruthy();
  });

  it("renders the main offset wallet — balance = banked earned − derived spend (v1.33)", () => {
    render(<Leaves />);
    // Alice: ledger earned 1, one Offset leave → used 1 → balance 0 in the wallet card.
    const wallet = screen.getByRole("list", { name: /Offset balances/i });
    expect(wallet.textContent).toContain("Alice");
    expect(wallet.textContent).toMatch(/earned 1 · used 1/);
  });
});
