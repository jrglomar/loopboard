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

  // v1.61 (ADR-073, item 175): get_multi_sprint_report rejects sprintIds arrays over 26.
  it("shows a (max 26) hint next to the group label", () => {
    render(<SprintRangePicker {...baseProps()} mode="pick" />);
    expect(screen.getByText("Select sprints")).toBeTruthy();
    expect(screen.getByText("(max 26)")).toBeTruthy();
  });

  it("does not disable any checkbox while under the 26 cap", () => {
    render(<SprintRangePicker {...baseProps()} mode="pick" pickedIds={[6]} />);
    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(checkboxes.every((c) => !c.disabled)).toBe(true);
  });

  // ids start at 100 — ACTIVE (id 7) / CLOSED (id 6) fixtures must stay OUTSIDE the picked set.
  it("disables UNCHECKED checkboxes once 26 are picked, but leaves checked ones enabled", () => {
    const manyClosed = Array.from({ length: 26 }, (_, i) => sprint({ id: 100 + i, name: `Sprint ${100 + i}` }));
    const pickedIds = manyClosed.map((s) => s.id); // all 26 closed sprints picked
    render(
      <SprintRangePicker
        {...baseProps()}
        mode="pick"
        active={ACTIVE} // Sprint 7 — NOT in pickedIds, must be disabled
        closed={manyClosed}
        pickedIds={pickedIds}
      />
    );
    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(checkboxes).toHaveLength(27);
    const unchecked = checkboxes.filter((c) => !c.checked);
    const checked = checkboxes.filter((c) => c.checked);
    expect(unchecked).toHaveLength(1); // Sprint 7
    expect(unchecked.every((c) => c.disabled)).toBe(true);
    expect(checked).toHaveLength(26);
    expect(checked.every((c) => !c.disabled)).toBe(true);
  });

  // Note: a real browser never dispatches click/change on a `disabled` form control, so setting
  // the `disabled` HTML attribute (verified above) is what actually blocks the user — jsdom's
  // fireEvent.click bypasses that browser-level gate via direct dispatchEvent, so it is not a
  // reliable way to assert the negative here.
  it("unchecking an already-picked sprint still works at the cap (never blocks removal)", () => {
    const onTogglePicked = vi.fn();
    const manyClosed = Array.from({ length: 26 }, (_, i) => sprint({ id: 100 + i, name: `Sprint ${100 + i}` }));
    render(
      <SprintRangePicker
        {...baseProps()}
        mode="pick"
        active={[]}
        closed={manyClosed}
        pickedIds={manyClosed.map((s) => s.id)}
        onTogglePicked={onTogglePicked}
      />
    );
    const [firstChecked] = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(firstChecked!.disabled).toBe(false);
    fireEvent.click(firstChecked!);
    expect(onTogglePicked).toHaveBeenCalledWith(100);
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
