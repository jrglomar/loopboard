// TeamKpiSection tests — v1.59, ADR-071. Presentational; keyless/offline.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { TeamKpiSection } from "./TeamKpiSection";
import type { MultiSprintReport } from "../../lib/types";

afterEach(() => cleanup());

const REPORT: MultiSprintReport = {
  boardId: 1,
  sprintCount: 2,
  sprints: [
    {
      sprint: {
        id: 50, name: "Sprint 4", state: "closed",
        startDate: "2026-04-01", endDate: "2026-04-14", completeDate: "2026-04-14", goal: null, boardId: 1,
      },
      committedPoints: 30, completedPoints: 28, completionRate: 0.9333333,
      totalCount: 8, completedCount: 7, carryoverCount: 1, blockedCount: 0,
      byAssignee: [],
    },
    {
      sprint: {
        id: 54, name: "Sprint 6", state: "closed",
        startDate: "2026-05-12", endDate: "2026-05-25", completeDate: "2026-05-25", goal: null, boardId: 1,
      },
      committedPoints: 40, completedPoints: 32, completionRate: 0.8,
      totalCount: 10, completedCount: 8, carryoverCount: 2, blockedCount: 1,
      byAssignee: [],
    },
  ],
  totals: { committedPoints: 70, completedPoints: 60 },
  averageCompleted: 30.333333,
  averageCompletionRate: 0.8666665,
  byAssignee: [],
};

describe("TeamKpiSection", () => {
  it("shows the Avg completed / sprint tile formatted with formatPoints", () => {
    render(<TeamKpiSection report={REPORT} />);
    const label = screen.getByText("Avg completed / sprint");
    expect(label.nextElementSibling?.textContent).toBe("30.33"); // formatPoints(30.333333)
  });

  it("shows the Avg completion rate tile as a rounded percentage", () => {
    render(<TeamKpiSection report={REPORT} />);
    const label = screen.getByText("Avg completion rate");
    expect(label.nextElementSibling?.textContent).toBe("87%");
  });

  it("renders the team bar chart with one bar per sprint", () => {
    render(<TeamKpiSection report={REPORT} />);
    expect(screen.getByText("Sprint 4")).toBeTruthy();
    expect(screen.getByText("Sprint 6")).toBeTruthy();
  });

  it("does NOT render a forecast or best/worst-sprint tile (locked out of scope)", () => {
    render(<TeamKpiSection report={REPORT} />);
    expect(screen.queryByText(/forecast/i)).toBeNull();
    expect(screen.queryByText(/best sprint/i)).toBeNull();
    expect(screen.queryByText(/worst sprint/i)).toBeNull();
  });
});
