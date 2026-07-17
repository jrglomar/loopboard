// DeveloperKpiSection tests — v1.59, ADR-071; leave-adjusted v1.60, ADR-072.
// Presentational; keyless/offline. devKpis fixtures come from the pure computeDevKpis()
// (itself unit-tested in lib/kpiAdjust.test.ts) so the prop shapes can never drift.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { DeveloperKpiSection } from "./DeveloperKpiSection";
import { computeDevKpis } from "../../lib/kpiAdjust";
import type { AllLeavesMap } from "../../lib/leavesClient";
import type { MultiSprintReport } from "../../lib/types";

afterEach(() => cleanup());

const REQUIRED_POINTS = 8;

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
  byAssignee: [
    { name: "Alice", sprintsActive: 3, donePoints: 46, totalPoints: 55, avgDonePoints: 15.333 },
    { name: "Bob", sprintsActive: 2, donePoints: 15, totalPoints: 20, avgDonePoints: 5 },
  ],
};

// No plotted leaves → every sprint's target is the flat REQUIRED_POINTS.
// Alice: 18✓ 20✓ 8✓ (8 >= 8) → 3 of 3. Bob: 10✓, 0✗ (absent), 5✗ → 1 of 3.
const DEV_KPIS = computeDevKpis(REPORT, {}, REQUIRED_POINTS);

// Carol: fully on leave in Sprint 4 (8 plotted days → target 0 → met at 0 done), zero tickets
// anywhere in the window — the leaves-only union case.
const LEAVES_WITH_CAROL: AllLeavesMap = {
  "50": {
    Carol: {
      "2026-04-01": "VL", "2026-04-02": "VL", "2026-04-03": "EL", "2026-04-06": "Holiday",
      "2026-04-07": "Offset", "2026-04-08": "VL", "2026-04-09": "VL", "2026-04-10": "VL",
    },
  },
};
const DEV_KPIS_WITH_CAROL = computeDevKpis(REPORT, LEAVES_WITH_CAROL, REQUIRED_POINTS);

describe("DeveloperKpiSection", () => {
  it("defaults the select to the top donePoints developer", () => {
    render(<DeveloperKpiSection report={REPORT} devKpis={DEV_KPIS} />);
    const select = screen.getByRole("combobox", { name: /select developer/i }) as HTMLSelectElement;
    expect(select.value).toBe("Alice");
  });

  it("lists every devKpis name as a select option", () => {
    render(<DeveloperKpiSection report={REPORT} devKpis={DEV_KPIS} />);
    const select = screen.getByRole("combobox", { name: /select developer/i });
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
    expect(options).toEqual(["Alice", "Bob"]);
  });

  it("shows the selected developer's avgDonePoints tile", () => {
    render(<DeveloperKpiSection report={REPORT} devKpis={DEV_KPIS} />);
    const label = screen.getByText("Avg done pts / sprint");
    expect(label.nextElementSibling?.textContent).toBe("15.33"); // formatPoints(46 / 3)
  });

  it("shows the 'Met target' tile as metCount of sprintCount (v1.60)", () => {
    render(<DeveloperKpiSection report={REPORT} devKpis={DEV_KPIS} />);
    const label = screen.getByText("Met target");
    expect(label.nextElementSibling?.textContent).toBe("3 of 3"); // Alice: 18, 20, 8 all >= 8
  });

  it("shows 'active in N of M sprints'", () => {
    render(<DeveloperKpiSection report={REPORT} devKpis={DEV_KPIS} />);
    const line = screen.getByText(/Active in/);
    expect(line.textContent).toContain("3"); // Alice active in all 3
    expect(line.textContent).toContain("sprints");
  });

  it("switching the developer updates the avg and met tiles", () => {
    render(<DeveloperKpiSection report={REPORT} devKpis={DEV_KPIS} />);
    const select = screen.getByRole("combobox", { name: /select developer/i });
    fireEvent.change(select, { target: { value: "Bob" } });
    expect(screen.getByText("Avg done pts / sprint").nextElementSibling?.textContent).toBe("5");
    expect(screen.getByText("Met target").nextElementSibling?.textContent).toBe("1 of 3");
  });

  it("charts donePoints against the adjusted target as the secondary series (v1.60)", () => {
    render(<DeveloperKpiSection report={REPORT} devKpis={DEV_KPIS} />);
    const select = screen.getByRole("combobox", { name: /select developer/i });
    fireEvent.change(select, { target: { value: "Bob" } });
    // Bob's Sprint 4: donePoints 10 vs adjusted target 8 — both in the bar's aria-label.
    expect(screen.getByLabelText("Sprint 4: Target (adj) 8, Done 10")).toBeTruthy();
  });

  it("renders 0 for a sprint where the selected developer is absent from byAssignee", () => {
    render(<DeveloperKpiSection report={REPORT} devKpis={DEV_KPIS} />);
    const select = screen.getByRole("combobox", { name: /select developer/i });
    fireEvent.change(select, { target: { value: "Bob" } });
    // Bob is absent from Sprint 5's byAssignee — both the chart and the table render 0.
    expect(screen.getByLabelText("Sprint 5: Target (adj) 8, Done 0")).toBeTruthy();
    const matches = screen.getAllByText("Sprint 5");
    const row = matches.map((el) => el.closest("tr")).find((tr): tr is HTMLTableRowElement => tr !== null);
    expect(row?.textContent).toContain("0");
  });

  it("renders Leaves (d) and Target (adj) table columns with met/missed marks (v1.60)", () => {
    render(<DeveloperKpiSection report={REPORT} devKpis={DEV_KPIS} />);
    expect(screen.getByText("Leaves (d)")).toBeTruthy();
    // "Target (adj)" appears as both the chart legend and the table header.
    expect(screen.getAllByText("Target (adj)").length).toBeGreaterThanOrEqual(2);
    // Alice met the target in all 3 sprints — 3 accessible "met" marks, no "missed".
    expect(screen.getAllByLabelText("met")).toHaveLength(3);
    expect(screen.queryByLabelText("missed")).toBeNull();

    const select = screen.getByRole("combobox", { name: /select developer/i });
    fireEvent.change(select, { target: { value: "Bob" } });
    expect(screen.getAllByLabelText("met")).toHaveLength(1); // Sprint 4 only
    expect(screen.getAllByLabelText("missed")).toHaveLength(2); // Sprints 5 + 6
  });

  it("includes a leaves-only dev in the select, met at a fully-covered sprint (v1.60)", () => {
    render(<DeveloperKpiSection report={REPORT} devKpis={DEV_KPIS_WITH_CAROL} />);
    const select = screen.getByRole("combobox", { name: /select developer/i });
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
    expect(options).toEqual(["Alice", "Bob", "Carol"]); // 0 done pts → sorts last

    fireEvent.change(select, { target: { value: "Carol" } });
    expect(screen.getByText("Avg done pts / sprint").nextElementSibling?.textContent).toBe("0");
    // Sprint 4: 8 leave days → target max(0, 8−8)=0 → met at 0 done. Sprints 5+6: target 8, missed.
    expect(screen.getByText("Met target").nextElementSibling?.textContent).toBe("1 of 3");
    expect(screen.getByLabelText("Sprint 4: Target (adj) 0, Done 0")).toBeTruthy();
    const line = screen.getByText(/Active in/);
    expect(line.textContent).toContain("0"); // zero tickets anywhere in the window
  });

  it("shows a subtle note while the leaves store is still loading (v1.60)", () => {
    render(<DeveloperKpiSection report={REPORT} devKpis={DEV_KPIS} leavesLoading />);
    expect(screen.getByText("(leaves loading…)")).toBeTruthy();
  });

  it("shows no leaves-loading note by default", () => {
    render(<DeveloperKpiSection report={REPORT} devKpis={DEV_KPIS} />);
    expect(screen.queryByText("(leaves loading…)")).toBeNull();
  });

  it("shows an empty message when there is no assignee data", () => {
    render(<DeveloperKpiSection report={REPORT} devKpis={[]} />);
    expect(screen.getByText(/No assignee data in this window/i)).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("does NOT render reliability/throughput/capacity KPIs (locked out of scope)", () => {
    render(<DeveloperKpiSection report={REPORT} devKpis={DEV_KPIS} />);
    expect(screen.queryByText(/reliability/i)).toBeNull();
    expect(screen.queryByText(/throughput/i)).toBeNull();
    expect(screen.queryByText(/capacity/i)).toBeNull();
  });
});
