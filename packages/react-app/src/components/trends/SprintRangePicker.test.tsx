// SprintRangePicker tests — v1.59, ADR-071. Presentational/controlled; keyless/offline.

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { SprintRangePicker, type SprintRangePickerProps } from "./SprintRangePicker";
import type { SprintRef } from "../../lib/types";

afterEach(() => cleanup());

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

const ACTIVE = [sprint({ id: 7, name: "Sprint 7", state: "active", startDate: "2026-06-01", endDate: "2026-06-14" })];
const CLOSED = [sprint({ id: 6, name: "Sprint 6", startDate: "2026-05-12", endDate: "2026-05-25" })];

function baseProps(): SprintRangePickerProps {
  return {
    mode: "recent",
    onModeChange: vi.fn(),
    lastN: 10,
    onLastNChange: vi.fn(),
    active: ACTIVE,
    closed: CLOSED,
    pickedIds: [],
    onTogglePicked: vi.fn(),
    rangeStart: "",
    rangeEnd: "",
    onRangeStartChange: vi.fn(),
    onRangeEndChange: vi.fn(),
  };
}

describe("SprintRangePicker — mode segmented control", () => {
  it("marks the current mode aria-pressed=true and the others false", () => {
    render(<SprintRangePicker {...baseProps()} mode="pick" />);
    expect(screen.getByRole("button", { name: "Last N" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Pick sprints" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Date range" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("fires onModeChange with the clicked mode", () => {
    const onModeChange = vi.fn();
    render(<SprintRangePicker {...baseProps()} onModeChange={onModeChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Pick sprints" }));
    expect(onModeChange).toHaveBeenCalledWith("pick");
    fireEvent.click(screen.getByRole("button", { name: "Date range" }));
    expect(onModeChange).toHaveBeenCalledWith("range");
  });

  it("uses role=group with an accessible label for the segmented control", () => {
    render(<SprintRangePicker {...baseProps()} />);
    expect(screen.getByRole("group", { name: /sprint selection mode/i })).toBeTruthy();
  });
});

describe("SprintRangePicker — recent mode", () => {
  it("shows the Last N input with the current value", () => {
    render(<SprintRangePicker {...baseProps()} lastN={7} />);
    const input = screen.getByLabelText(/Last N closed sprints/i) as HTMLInputElement;
    expect(input.value).toBe("7");
  });

  it("fires onLastNChange when the number input changes", () => {
    const onLastNChange = vi.fn();
    render(<SprintRangePicker {...baseProps()} onLastNChange={onLastNChange} />);
    const input = screen.getByLabelText(/Last N closed sprints/i);
    fireEvent.change(input, { target: { value: "5" } });
    expect(onLastNChange).toHaveBeenCalledWith(5);
  });
});

describe("SprintRangePicker — pick mode", () => {
  it("groups sprints under Active and Closed headings with checkboxes", () => {
    render(<SprintRangePicker {...baseProps()} mode="pick" />);
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("Closed")).toBeTruthy();
    expect(screen.getByText("Sprint 7", { exact: false })).toBeTruthy();
    expect(screen.getByText("Sprint 6", { exact: false })).toBeTruthy();
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  });

  it("reflects pickedIds as checked", () => {
    render(<SprintRangePicker {...baseProps()} mode="pick" pickedIds={[6]} />);
    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    const checked = checkboxes.filter((c) => c.checked);
    expect(checked).toHaveLength(1);
  });

  it("fires onTogglePicked with the clicked sprint's id", () => {
    const onTogglePicked = vi.fn();
    render(<SprintRangePicker {...baseProps()} mode="pick" onTogglePicked={onTogglePicked} />);
    const [activeCheckbox] = screen.getAllByRole("checkbox");
    fireEvent.click(activeCheckbox);
    expect(onTogglePicked).toHaveBeenCalledWith(7);
  });

  it("shows a friendly message when a group is empty", () => {
    render(<SprintRangePicker {...baseProps()} mode="pick" active={[]} />);
    expect(screen.getByText(/No active sprints/i)).toBeTruthy();
  });
});

describe("SprintRangePicker — range mode", () => {
  it("renders native date inputs and fires the change callbacks", () => {
    const onRangeStartChange = vi.fn();
    const onRangeEndChange = vi.fn();
    render(
      <SprintRangePicker
        {...baseProps()}
        mode="range"
        onRangeStartChange={onRangeStartChange}
        onRangeEndChange={onRangeEndChange}
      />
    );
    const from = screen.getByLabelText(/^From$/i) as HTMLInputElement;
    const to = screen.getByLabelText(/^To$/i) as HTMLInputElement;
    expect(from.type).toBe("date");
    expect(to.type).toBe("date");

    fireEvent.change(from, { target: { value: "2026-01-01" } });
    expect(onRangeStartChange).toHaveBeenCalledWith("2026-01-01");

    fireEvent.change(to, { target: { value: "2026-02-01" } });
    expect(onRangeEndChange).toHaveBeenCalledWith("2026-02-01");
  });
});
