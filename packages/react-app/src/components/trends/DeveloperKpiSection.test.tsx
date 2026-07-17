// DeveloperKpiSection tests — v1.59, ADR-071. Presentational; keyless/offline.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { DeveloperKpiSection } from "./DeveloperKpiSection";
import type { MultiSprintReport } from "../../lib/types";

afterEach(() => cleanup());

const REPORT: MultiSprintReport = {
  boardId: 1,
  sprintCount: 3,
  sprints: [
    {
      sprint: {
        id: 50, name: "Sprint 4", state: "closed",
        startDate: "2026-04-01", endDate: "2026-04-14", completeDate: "2026-04-14", goal: null, boardId: 1,
      },
      committedPoints: 30, completedPoints: 28, completionRate: 0.93,
      totalCount: 8, completedCount: 7, carryoverCount: 1, blockedCount: 0,
      byAssignee: [
        { name: "Alice", donePoints: 18, totalPoints: 20, doneCount: 4, totalCount: 5 },
        { name: "Bob", donePoints: 10, totalPoints: 10, doneCount: 3, totalCount: 3 },
      ],
    },
    {
      sprint: {
        id: 52, name: "Sprint 5", state: "closed",
        startDate: "2026-04-15", endDate: "2026-04-28", completeDate: "2026-04-28", goal: null, boardId: 1,
      },
      committedPoints: 35, completedPoints: 30, completionRate: 0.86,
      totalCount: 9, completedCount: 8, carryoverCount: 1, blockedCount: 0,
      // Bob has no issues this sprint — absent from byAssignee (must render as 0, not skipped)
      byAssignee: [{ name: "Alice", donePoints: 20, totalPoints: 22, doneCount: 4, totalCount: 5 }],
    },
    {
      sprint: {
        id: 54, name: "Sprint 6", state: "closed",
        startDate: "2026-05-12", endDate: "2026-05-25", completeDate: "2026-05-25", goal: null, boardId: 1,
      },
      committedPoints: 40, completedPoints: 32, completionRate: 0.8,
      totalCount: 10, completedCount: 8, carryoverCount: 2, blockedCount: 1,
      byAssignee: [
        { name: "Alice", donePoints: 8, totalPoints: 13, doneCount: 1, totalCount: 2 },
        { name: "Bob", donePoints: 5, totalPoints: 10, doneCount: 1, totalCount: 2 },
      ],
    },
  ],
  totals: { committedPoints: 105, completedPoints: 90 },
  averageCompleted: 30,
  averageCompletionRate: 0.863,
  // donePoints desc, per the backend contract — Alice (46) is "top donePoints".
  byAssignee: [
    { name: "Alice", sprintsActive: 3, donePoints: 46, totalPoints: 55, avgDonePoints: 15.333 },
    { name: "Bob", sprintsActive: 2, donePoints: 15, totalPoints: 20, avgDonePoints: 5 },
  ],
};

describe("DeveloperKpiSection", () => {
  it("defaults the select to the top donePoints developer", () => {
    render(<DeveloperKpiSection report={REPORT} />);
    const select = screen.getByRole("combobox", { name: /select developer/i }) as HTMLSelectElement;
    expect(select.value).toBe("Alice");
  });

  it("lists every byAssignee name as a select option", () => {
    render(<DeveloperKpiSection report={REPORT} />);
    const select = screen.getByRole("combobox", { name: /select developer/i });
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
    expect(options).toEqual(["Alice", "Bob"]);
  });

  it("shows the selected developer's avgDonePoints tile", () => {
    render(<DeveloperKpiSection report={REPORT} />);
    const label = screen.getByText("Avg done pts / sprint");
    expect(label.nextElementSibling?.textContent).toBe("15.33"); // formatPoints(15.333)
  });

  it("shows 'active in N of M sprints'", () => {
    render(<DeveloperKpiSection report={REPORT} />);
    const line = screen.getByText(/Active in/);
    expect(line.textContent).toContain("3"); // sprintsActive
    expect(line.textContent).toContain("sprints");
  });

  it("switching the developer updates the avg tile", () => {
    render(<DeveloperKpiSection report={REPORT} />);
    const select = screen.getByRole("combobox", { name: /select developer/i });
    fireEvent.change(select, { target: { value: "Bob" } });
    const label = screen.getByText("Avg done pts / sprint");
    expect(label.nextElementSibling?.textContent).toBe("5"); // formatPoints(5)
  });

  it("switching the developer updates the chart (bar aria-label reflects the new dev)", () => {
    render(<DeveloperKpiSection report={REPORT} />);
    const select = screen.getByRole("combobox", { name: /select developer/i });
    fireEvent.change(select, { target: { value: "Bob" } });
    // Bob's Sprint 4 donePoints = 10
    expect(screen.getByLabelText("Sprint 4: Done 10")).toBeTruthy();
  });

  it("renders 0 for a sprint where the selected developer is absent from byAssignee", () => {
    render(<DeveloperKpiSection report={REPORT} />);
    const select = screen.getByRole("combobox", { name: /select developer/i });
    fireEvent.change(select, { target: { value: "Bob" } });
    // Bob is absent from Sprint 5's byAssignee — both the chart and the small table render 0.
    expect(screen.getByLabelText("Sprint 5: Done 0")).toBeTruthy();
    const matches = screen.getAllByText("Sprint 5");
    const row = matches.map((el) => el.closest("tr")).find((tr): tr is HTMLTableRowElement => tr !== null);
    expect(row?.textContent).toContain("0");
  });

  it("shows an empty message when there is no assignee data", () => {
    const empty: MultiSprintReport = { ...REPORT, byAssignee: [] };
    render(<DeveloperKpiSection report={empty} />);
    expect(screen.getByText(/No assignee data in this window/i)).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("does NOT render reliability/throughput/capacity KPIs (locked out of scope)", () => {
    render(<DeveloperKpiSection report={REPORT} />);
    expect(screen.queryByText(/reliability/i)).toBeNull();
    expect(screen.queryByText(/throughput/i)).toBeNull();
    expect(screen.queryByText(/capacity/i)).toBeNull();
  });
});
