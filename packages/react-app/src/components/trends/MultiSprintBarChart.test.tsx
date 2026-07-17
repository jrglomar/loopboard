// MultiSprintBarChart tests — v1.59, ADR-071. Presentational; keyless/offline.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MultiSprintBarChart } from "./MultiSprintBarChart";

afterEach(() => cleanup());

describe("MultiSprintBarChart", () => {
  it("renders one bar group per series entry (by its visible label)", () => {
    render(
      <MultiSprintBarChart
        series={[
          { label: "Sprint 4", primary: 28, secondary: 30 },
          { label: "Sprint 5", primary: 30, secondary: 35 },
          { label: "Sprint 6", primary: 32, secondary: 40 },
        ]}
        primaryLabel="Completed"
        secondaryLabel="Committed"
      />
    );
    expect(screen.getByText("Sprint 4")).toBeTruthy();
    expect(screen.getByText("Sprint 5")).toBeTruthy();
    expect(screen.getByText("Sprint 6")).toBeTruthy();
  });

  it("includes the label and both values in each bar's aria-label", () => {
    render(
      <MultiSprintBarChart
        series={[{ label: "Sprint 4", primary: 28, secondary: 30 }]}
        primaryLabel="Completed"
        secondaryLabel="Committed"
      />
    );
    expect(screen.getByLabelText("Sprint 4: Committed 30, Completed 28")).toBeTruthy();
  });

  it("counts bar groups via aria-label — matches the series length", () => {
    render(
      <MultiSprintBarChart
        series={[
          { label: "Sprint 4", primary: 28, secondary: 30 },
          { label: "Sprint 5", primary: 30, secondary: 35 },
        ]}
        primaryLabel="Completed"
        secondaryLabel="Committed"
      />
    );
    // Each bar group's aria-label starts with "<sprint name>: " — 2 series → 2 matches.
    expect(screen.getAllByLabelText(/^Sprint \d: /)).toHaveLength(2);
  });

  it("primary-only series (no secondary) formats a single-value aria-label", () => {
    render(<MultiSprintBarChart series={[{ label: "Alice", primary: 12 }]} primaryLabel="Done" />);
    expect(screen.getByLabelText("Alice: Done 12")).toBeTruthy();
  });

  it("renders the title when provided", () => {
    render(
      <MultiSprintBarChart title="Team trend" series={[{ label: "S1", primary: 5 }]} primaryLabel="Done" />
    );
    expect(screen.getByText("Team trend")).toBeTruthy();
  });

  it("shows an empty message when series is empty", () => {
    render(<MultiSprintBarChart series={[]} primaryLabel="Done" />);
    expect(screen.getByText(/No sprint data to chart/i)).toBeTruthy();
  });

  it("formats values with formatPoints (decimals trimmed to 2 places)", () => {
    render(<MultiSprintBarChart series={[{ label: "Sprint X", primary: 13.5 }]} primaryLabel="Done" />);
    expect(screen.getByLabelText("Sprint X: Done 13.5")).toBeTruthy();
  });
});
