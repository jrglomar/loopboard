// LeavesPlannerCard tests — v1.29, ADR-041. Keyless/offline.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { LeavesPlannerCard } from "./LeavesPlannerCard";
import type { SprintRef } from "../lib/types";

function sprint(over: Partial<SprintRef>): SprintRef {
  return {
    id: 7, name: "S7", state: "active", startDate: "2026-06-01", endDate: "2026-06-05",
    completeDate: null, goal: null, boardId: 10, ...over,
  };
}

afterEach(() => cleanup());

describe("LeavesPlannerCard (v1.29)", () => {
  it("renders the sprint group header and a painted leave cell", () => {
    render(
      <LeavesPlannerCard
        sprints={[sprint({})]}
        roster={["Alice"]}
        leavesBySprint={{ "7": { Alice: { "2026-06-02": "VL" } } }}
        paintType="EL"
        onPlot={vi.fn()}
      />
    );
    expect(screen.getByText("S7")).toBeTruthy(); // sprint segment label
    expect(screen.getByText("Alice")).toBeTruthy();
    // The 06-02 cell shows the VL abbreviation
    expect(screen.getByRole("button", { name: /Alice VL on 2026-06-02/i })).toBeTruthy();
  });

  it("plots the selected type on an empty day and saves the FULL set for that day's sprint", () => {
    const onPlot = vi.fn();
    render(
      <LeavesPlannerCard
        sprints={[sprint({})]}
        roster={["Alice"]}
        leavesBySprint={{ "7": { Alice: { "2026-06-02": "VL" } } }}
        paintType="EL"
        onPlot={onPlot}
      />
    );
    // Click the empty Monday 06-01 cell → paints EL, keeping the existing VL on 06-02
    fireEvent.click(screen.getByRole("button", { name: /Alice working on 2026-06-01/i }));
    expect(onPlot).toHaveBeenCalledTimes(1);
    const [sprintId, assignee, entries] = onPlot.mock.calls[0]!;
    expect(sprintId).toBe(7);
    expect(assignee).toBe("Alice");
    expect(entries).toEqual(
      expect.arrayContaining([
        { date: "2026-06-02", type: "VL" },
        { date: "2026-06-01", type: "EL" },
      ])
    );
  });

  it("clears a day when the painted type matches the existing type", () => {
    const onPlot = vi.fn();
    render(
      <LeavesPlannerCard
        sprints={[sprint({})]}
        roster={["Alice"]}
        leavesBySprint={{ "7": { Alice: { "2026-06-02": "VL" } } }}
        paintType="VL"
        onPlot={onPlot}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Alice VL on 2026-06-02/i }));
    const [, , entries] = onPlot.mock.calls[0]!;
    expect(entries).toEqual([]); // the only leave was cleared
  });

  it("shows an empty state when there are no dated sprints", () => {
    render(<LeavesPlannerCard sprints={[]} roster={["Alice"]} leavesBySprint={{}} paintType="VL" onPlot={vi.fn()} />);
    expect(screen.getByText(/No sprints with start\/end dates/i)).toBeTruthy();
  });

  it("shows a no-team state when the roster is empty", () => {
    render(<LeavesPlannerCard sprints={[sprint({})]} roster={[]} leavesBySprint={{}} paintType="VL" onPlot={vi.fn()} />);
    expect(screen.getByText(/No team members yet/i)).toBeTruthy();
  });
});
