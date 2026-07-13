// BankOffsetsDialog — v1.50, ADR-061. Keyless/offline.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { BankOffsetsDialog, type BankRow } from "./BankOffsetsDialog";

afterEach(() => cleanup());

function open(rows: BankRow[], onConfirm = vi.fn().mockResolvedValue(undefined)) {
  render(
    <BankOffsetsDialog open onOpenChange={vi.fn()} sprintName="Sprint 42" rows={rows} onConfirm={onConfirm} />
  );
  return onConfirm;
}

describe("BankOffsetsDialog (v1.50)", () => {
  it("lists only developers who earned an offset", () => {
    open([
      { name: "Alice", earned: 1, banked: null },
      { name: "Bob", earned: 0, banked: null },
    ]);
    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.queryByText("Bob")).toBeNull(); // earned 0 → not shown
  });

  it("banks on confirm", async () => {
    const onConfirm = open([{ name: "Alice", earned: 1, banked: null }]);
    fireEvent.click(screen.getByRole("button", { name: /^bank offsets$/i }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  });

  it("disables confirm when everything is already banked (no change)", () => {
    open([{ name: "Alice", earned: 1, banked: 1 }]);
    expect(screen.getByText(/confirming changes nothing/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^bank offsets$/i }).hasAttribute("disabled")).toBe(true);
  });

  it("shows the banked→new transition when re-banking a changed value", () => {
    open([{ name: "Alice", earned: 1, banked: 0 }]);
    expect(screen.getByText(/banked 0/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^bank offsets$/i }).hasAttribute("disabled")).toBe(false);
  });

  it("says there's nothing to bank when no one earned", () => {
    open([{ name: "Alice", earned: 0, banked: null }]);
    expect(screen.getByText(/nothing to bank/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^bank offsets$/i }).hasAttribute("disabled")).toBe(true);
  });
});
