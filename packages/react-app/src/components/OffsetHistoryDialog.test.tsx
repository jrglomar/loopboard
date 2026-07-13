// OffsetHistoryDialog tests — v1.33, ADR-044 (Phase 2); v1.54, ADR-065 (earned + adjustments). Keyless.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { OffsetHistoryDialog } from "./OffsetHistoryDialog";
import type { OffsetHistory } from "../lib/offsetWallet";

const HISTORY: OffsetHistory = {
  earned: 3, spent: 2, manual: 1, adjustmentsTotal: 2, balance: 4,
  usage: [
    { date: "2026-06-10", sprintId: 2, sprintName: "Sprint Two" },
    { date: "2026-06-02", sprintId: 1, sprintName: "Sprint One" },
  ],
  earnedBySprint: [
    { sprintId: 2, sprintName: "Sprint Two", earned: 1 },
    { sprintId: 1, sprintName: "Sprint One", earned: 2 },
  ],
  adjustments: [
    { id: "adj1", amount: 3, note: "weekend on-call", createdAt: "2026-07-05T00:00:00Z" },
    { id: "adj2", amount: -1, createdAt: "2026-07-01T00:00:00Z" },
  ],
};

const EMPTY: OffsetHistory = {
  earned: 0, spent: 0, manual: 0, adjustmentsTotal: 0, balance: 0,
  usage: [], earnedBySprint: [], adjustments: [],
};

afterEach(() => cleanup());

describe("OffsetHistoryDialog (v1.33 / v1.54)", () => {
  it("shows the standing + earned + usage + adjustments lists when open", () => {
    render(<OffsetHistoryDialog assignee="Alice" history={HISTORY} open onOpenChange={() => {}} />);
    expect(screen.getByText(/Offset history — Alice/)).toBeTruthy();

    const earned = screen.getByRole("list", { name: /Offset earned history/i });
    expect(earned.textContent).toContain("Sprint Two");
    expect(earned.textContent).toContain("+2"); // Sprint One earned 2

    const usage = screen.getByRole("list", { name: /Offset usage history/i });
    expect(usage.textContent).toContain("Sprint One");

    const adjustments = screen.getByRole("list", { name: /Manual adjustments/i });
    expect(adjustments.textContent).toContain("weekend on-call");
    expect(adjustments.textContent).toContain("+3");
    expect(adjustments.textContent).toContain("−1"); // minus sign (U+2212)
  });

  it("shows empty states for each section", () => {
    render(<OffsetHistoryDialog assignee="Bob" history={EMPTY} open onOpenChange={() => {}} />);
    expect(screen.getByText(/Nothing banked yet/i)).toBeTruthy();
    expect(screen.getByText(/No offsets used yet/i)).toBeTruthy();
    expect(screen.getByText(/No manual adjustments/i)).toBeTruthy();
  });

  it("adds a manual adjustment via the form (parsed amount + note)", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<OffsetHistoryDialog assignee="Alice" history={EMPTY} open onOpenChange={() => {}} onAddAdjustment={onAdd} />);

    const add = screen.getByRole("button", { name: /^add$/i });
    expect(add.hasAttribute("disabled")).toBe(true); // no amount yet

    fireEvent.change(screen.getByLabelText(/Amount/i), { target: { value: "-2" } });
    fireEvent.change(screen.getByLabelText(/Note/i), { target: { value: "comp day" } });
    expect(screen.getByRole("button", { name: /^add$/i }).hasAttribute("disabled")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith("Alice", -2, "comp day"));
  });

  it("does not enable Add for a zero amount", () => {
    render(<OffsetHistoryDialog assignee="Alice" history={EMPTY} open onOpenChange={() => {}} onAddAdjustment={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/Amount/i), { target: { value: "0" } });
    expect(screen.getByRole("button", { name: /^add$/i }).hasAttribute("disabled")).toBe(true);
  });

  it("accepts a DECIMAL amount in the add form (v1.55, ADR-066)", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<OffsetHistoryDialog assignee="Alice" history={EMPTY} open onOpenChange={() => {}} onAddAdjustment={onAdd} />);
    fireEvent.change(screen.getByLabelText(/Amount/i), { target: { value: "0.5" } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith("Alice", 0.5, ""));
  });

  it("renders decimal figures cleanly (formatPoints)", () => {
    const dec: OffsetHistory = {
      ...EMPTY, earned: 2.5, balance: 2.75,
      earnedBySprint: [{ sprintId: 1, sprintName: "Sprint One", earned: 0.5 }],
      adjustments: [{ id: "d", amount: 0.25, note: "half", createdAt: "2026-07-01T00:00:00Z" }],
    };
    render(<OffsetHistoryDialog assignee="Alice" history={dec} open onOpenChange={() => {}} />);
    expect(screen.getByRole("list", { name: /Offset earned history/i }).textContent).toContain("+0.5");
    expect(screen.getByRole("list", { name: /Manual adjustments/i }).textContent).toContain("+0.25");
  });

  it("removes an adjustment via its delete button", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(
      <OffsetHistoryDialog assignee="Alice" history={HISTORY} open onOpenChange={() => {}}
        onAddAdjustment={vi.fn()} onDeleteAdjustment={onDelete} />
    );
    fireEvent.click(screen.getByRole("button", { name: /Remove adjustment \+3/i }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("Alice", "adj1"));
  });

  it("is read-only (no add form, no delete) when no callbacks are given", () => {
    render(<OffsetHistoryDialog assignee="Alice" history={HISTORY} open onOpenChange={() => {}} />);
    expect(screen.queryByRole("button", { name: /^add$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Remove adjustment/i })).toBeNull();
  });

  it("renders nothing when closed", () => {
    render(<OffsetHistoryDialog assignee={null} history={null} open={false} onOpenChange={() => {}} />);
    expect(screen.queryByText(/Offset history/)).toBeNull();
  });
});
