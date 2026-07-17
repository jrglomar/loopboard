// MultiSprintTable tests — v1.59, ADR-071. Presentational; keyless/offline.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MultiSprintTable } from "./MultiSprintTable";
import type { MultiSprintReport } from "../../lib/types";

afterEach(() => cleanup());

const REPORT: MultiSprintReport = {
  boardId: 1,
  sprintCount: 2,
  sprints: [
    {
      sprint: {
        id: 50, name: "Sprint 4", state: "closed",
        startDate: "2026-04-01T00:00:00.000Z", endDate: "2026-04-14T00:00:00.000Z",
        completeDate: "2026-04-14T00:00:00.000Z", goal: null, boardId: 1,
      },
      committedPoints: 30, completedPoints: 28, completionRate: 0.9333333,
      totalCount: 8, completedCount: 7, carryoverCount: 1, blockedCount: 0,
      byAssignee: [],
    },
    {
      sprint: {
        id: 54, name: "Sprint 6", state: "closed",
        startDate: "2026-05-12T00:00:00.000Z", endDate: "2026-05-25T00:00:00.000Z",
        completeDate: "2026-05-25T00:00:00.000Z", goal: "Ship auth", boardId: 1,
      },
      committedPoints: 40, completedPoints: 32, completionRate: 0.8,
      totalCount: 10, completedCount: 8, carryoverCount: 2, blockedCount: 1,
      byAssignee: [],
    },
  ],
  totals: { committedPoints: 70, completedPoints: 60 },
  averageCompleted: 30,
  averageCompletionRate: 0.8666665,
  byAssignee: [],
};

describe("MultiSprintTable", () => {
  it("renders one row per sprint with name, dates, committed, completed, rate, carryover, blocked", () => {
    render(<MultiSprintTable report={REPORT} />);
    const table = screen.getByRole("table", { name: /multi-sprint report/i });
    expect(table).toBeTruthy();

    const row4 = screen.getByText("Sprint 4").closest("tr");
    expect(row4?.textContent).toContain("2026-04-01");
    expect(row4?.textContent).toContain("2026-04-14");
    expect(row4?.textContent).toContain("30"); // committed
    expect(row4?.textContent).toContain("28"); // completed
    expect(row4?.textContent).toContain("93%"); // rate

    const row6 = screen.getByText("Sprint 6").closest("tr");
    expect(row6?.textContent).toContain("40");
    expect(row6?.textContent).toContain("32");
    expect(row6?.textContent).toContain("80%");
    expect(row6?.textContent).toContain("2"); // carryover
    expect(row6?.textContent).toContain("1"); // blocked
  });

  it("renders a totals/average footer row", () => {
    const { container } = render(<MultiSprintTable report={REPORT} />);
    const footer = container.querySelector("tfoot");
    expect(footer).toBeTruthy();
    expect(footer?.textContent).toContain("Total / average");
    expect(footer?.textContent).toContain("70"); // totals.committedPoints
    expect(footer?.textContent).toContain("60"); // totals.completedPoints
    expect(footer?.textContent).toContain("87%"); // averageCompletionRate rounded
  });

  it("sums carryover and blocked counts across sprints in the footer", () => {
    const { container } = render(<MultiSprintTable report={REPORT} />);
    // Footer cells: [label, sprint count, committed, completed, rate, carryover, blocked].
    // Checked by cell index (not a substring/regex over the row's concatenated text) since
    // adjacent numeric cells (e.g. "3" next to "1") have no word boundary between them.
    const footerCells = container.querySelectorAll("tfoot td");
    expect(footerCells[5]?.textContent).toBe("3"); // carryover: 1 + 2
    expect(footerCells[6]?.textContent).toBe("1"); // blocked: 0 + 1
  });

  it("shows an empty message when there are no sprints", () => {
    const empty: MultiSprintReport = { ...REPORT, sprints: [] };
    render(<MultiSprintTable report={empty} />);
    expect(screen.getByText(/No sprints in this window/i)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("wraps the table in an overflow-x-auto container", () => {
    const { container } = render(<MultiSprintTable report={REPORT} />);
    expect(container.querySelector(".overflow-x-auto")).toBeTruthy();
  });
});
