// TrendsView tests — v1.59 (ADR-071); the 26-sprint window cap (v1.61, ADR-073, item 175).
// Keyless/offline. TrendsView is props-driven with NO context hooks (see its own file-header
// comment) — only the data hooks (useSprintList/useMultiSprintReport/useAllLeaves) need mocking,
// so it mounts standalone without Reports.tsx or the boards/policy context.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { TrendsView } from "./TrendsView";

vi.mock("../../hooks/useJira", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../hooks/useJira")>();
  return {
    ...actual,
    useSprintList: vi.fn(),
    useMultiSprintReport: vi.fn(),
    useAllLeaves: vi.fn(),
  };
});

import * as useJiraModule from "../../hooks/useJira";
import type { MultiSprintReport, SprintRef } from "../../lib/types";

function sprint(partial: Partial<SprintRef> & { id: number }): SprintRef {
  return {
    id: partial.id,
    name: partial.name ?? `Sprint ${partial.id}`,
    state: partial.state ?? "closed",
    startDate: partial.startDate ?? null,
    endDate: partial.endDate ?? null,
    completeDate: partial.completeDate ?? null,
    goal: partial.goal ?? null,
    boardId: partial.boardId ?? 1,
  };
}

// 27 CLOSED sprints, 14-day cadence starting 2026-01-01 — id 1 is the OLDEST (startDate
// 2026-01-01), id 27 the NEWEST (startDate 2026-12-31). A date range spanning the whole year
// selects all 27; the newest 26 (ids 2..27) should survive the cap.
const MANY_CLOSED: SprintRef[] = Array.from({ length: 27 }, (_, i) => {
  const id = i + 1;
  const start = new Date(Date.UTC(2026, 0, 1 + i * 14));
  const end = new Date(Date.UTC(2026, 0, 1 + i * 14 + 13));
  return sprint({
    id,
    name: `Sprint ${id}`,
    startDate: start.toISOString(),
    endDate: end.toISOString(),
  });
});

function setMocks() {
  vi.mocked(useJiraModule.useSprintList).mockReturnValue({
    data: { boardId: 1, active: [], future: [], closed: MANY_CLOSED },
    loading: false,
    error: null,
    run: vi.fn(),
  });
  vi.mocked(useJiraModule.useMultiSprintReport).mockReturnValue({
    data: null,
    loading: false,
    error: null,
    run: vi.fn(),
  });
  vi.mocked(useJiraModule.useAllLeaves).mockReturnValue({
    data: {},
    loading: false,
    error: null,
    run: vi.fn(),
    save: vi.fn().mockResolvedValue(undefined),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setMocks();
});

afterEach(() => cleanup());

async function renderTrends() {
  render(<TrendsView boardId={1} boardKey="DEV" requiredPoints={8} />);
  await waitFor(() => screen.getByRole("group", { name: /sprint selection mode/i }));
}

describe("TrendsView — 26-sprint window cap (v1.61, ADR-073, item 175)", () => {
  it("caps a wide date-range selection at the NEWEST 26 sprints and shows the cap note", async () => {
    await renderTrends();

    // Default mode is "range" (v1.60) — widen it to cover all 27 sprints' start dates.
    fireEvent.change(screen.getByLabelText(/^From$/i), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText(/^To$/i), { target: { value: "2026-12-31" } });

    await waitFor(() => {
      expect(screen.getByText(/Showing the latest 26 sprints in this range \(report limit\)\./i)).toBeTruthy();
    });

    const calls = vi.mocked(useJiraModule.useMultiSprintReport).mock.calls;
    const lastIds = calls[calls.length - 1]![0];
    expect(lastIds).toHaveLength(26);
    // Newest 26 = ids 2..27 — the oldest (id 1) was dropped.
    expect(lastIds).toEqual(Array.from({ length: 26 }, (_, i) => i + 2));
  });

  it("shows no cap note and sends every id when the selection is at or under 26", async () => {
    await renderTrends();

    // Only the first two sprints' start dates (2026-01-01, 2026-01-15) fall in this window.
    fireEvent.change(screen.getByLabelText(/^From$/i), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText(/^To$/i), { target: { value: "2026-01-15" } });

    await waitFor(() => {
      const calls = vi.mocked(useJiraModule.useMultiSprintReport).mock.calls;
      const lastIds = calls[calls.length - 1]![0];
      expect(lastIds).toEqual([1, 2]);
    });
    expect(screen.queryByText(/Showing the latest 26 sprints/i)).toBeNull();
  });
});

// v1.61 (ADR-073, item 177): styled "Team trends" .xlsx export — a SEPARATE download from the
// Developer KPIs button (that one lives in DeveloperKpiSection's own header, tested there).
// Mirrors SprintReviewExport.test.tsx's pattern: exercise the real builder, capture the Blob via
// a mocked createObjectURL, rather than mocking trendsXlsx.ts itself.
describe("TrendsView — styled xlsx export (v1.61, ADR-073, item 177)", () => {
  const ONE_SPRINT_REPORT: MultiSprintReport = {
    boardId: 1,
    sprintCount: 1,
    sprints: [
      {
        sprint: {
          id: 1, name: "Sprint 1", state: "closed",
          startDate: "2026-01-01T00:00:00.000Z", endDate: "2026-01-14T00:00:00.000Z",
          completeDate: "2026-01-14T00:00:00.000Z", goal: null, boardId: 1,
        },
        committedPoints: 10, completedPoints: 9, completionRate: 0.9,
        totalCount: 3, completedCount: 2, carryoverCount: 1, blockedCount: 0,
        byAssignee: [{ name: "Alice", donePoints: 9, totalPoints: 9, doneCount: 2, totalCount: 2 }],
      },
    ],
    totals: { committedPoints: 10, completedPoints: 9 },
    averageCompleted: 9,
    averageCompletionRate: 0.9,
    byAssignee: [{ name: "Alice", sprintsActive: 1, donePoints: 9, totalPoints: 9, avgDonePoints: 9 }],
  };

  let capturedBlob: Blob | null = null;

  beforeEach(() => {
    capturedBlob = null;
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn((b: Blob) => {
      capturedBlob = b;
      return "blob:x";
    });
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    vi.mocked(useJiraModule.useMultiSprintReport).mockReturnValue({
      data: ONE_SPRINT_REPORT,
      loading: false,
      error: null,
      run: vi.fn(),
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it("has a .xlsx (styled) export button that downloads a non-empty workbook", async () => {
    await renderTrends();
    // Narrow the default "range" mode so a selection resolves (fixture sprint starts 2026-01-01).
    fireEvent.change(screen.getByLabelText(/^From$/i), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText(/^To$/i), { target: { value: "2026-01-14" } });

    const button = await screen.findByRole("button", { name: /Download trends report as styled Excel workbook/i });
    fireEvent.click(button);

    expect(capturedBlob).toBeTruthy();
    expect(capturedBlob!.type).toContain("spreadsheetml");
    expect(capturedBlob!.size).toBeGreaterThan(0);
  });
});
