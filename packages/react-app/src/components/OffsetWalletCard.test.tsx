// OffsetWalletCard tests — v1.33, ADR-044. Keyless/offline.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { OffsetWalletCard } from "./OffsetWalletCard";
import type { OffsetWalletEntry } from "../lib/offsetWallet";

const WALLET: Record<string, OffsetWalletEntry> = {
  Alice: { earned: 3, spent: 1, manual: 0, balance: 2 },
  Bob: { earned: 0, spent: 1, manual: 0, balance: -1 },
};

afterEach(() => cleanup());

describe("OffsetWalletCard (v1.33)", () => {
  it("shows each developer's balance and earned/used", () => {
    render(<OffsetWalletCard wallet={WALLET} roster={["Alice", "Bob"]} />);
    const list = screen.getByRole("list", { name: /Offset balances/i });
    expect(list.textContent).toContain("Alice");
    expect(list.textContent).toContain("earned 3 · used 1");
    expect(list.textContent).toContain("Bob");
  });

  it("includes a rostered developer with no offset activity (balance 0)", () => {
    render(<OffsetWalletCard wallet={WALLET} roster={["Alice", "Carol"]} />);
    // Carol has no wallet entry → shown with earned 0 · used 0
    expect(screen.getByText("Carol")).toBeTruthy();
    expect(screen.getByRole("list").textContent).toContain("earned 0 · used 0");
  });

  it("renders a History button per row only when onHistory is provided", () => {
    const onHistory = vi.fn();
    const { rerender } = render(<OffsetWalletCard wallet={WALLET} roster={["Alice"]} />);
    expect(screen.queryByRole("button", { name: /Offset history for Alice/i })).toBeNull();

    rerender(<OffsetWalletCard wallet={WALLET} roster={["Alice"]} onHistory={onHistory} />);
    fireEvent.click(screen.getByRole("button", { name: /Offset history for Alice/i }));
    expect(onHistory).toHaveBeenCalledWith("Alice");
  });
});
