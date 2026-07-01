// offsetWallet.ts unit tests — v1.33, ADR-044. Pure; keyless/offline.

import { describe, it, expect } from "vitest";
import { countOffsetLeaves, computeOffsetWallet, buildOffsetHistory } from "./offsetWallet";
import type { OffsetLedger } from "./offsetClient";
import type { AllLeavesMap } from "./leavesClient";

const ALL_LEAVES: AllLeavesMap = {
  "1": {
    Alice: { "2026-06-02": "Offset", "2026-06-03": "VL" },
    Bob: { "2026-06-04": "Holiday" },
  },
  "2": {
    Alice: { "2026-06-10": "Offset" },
    Carol: { "2026-06-11": "Offset" },
  },
};

describe("countOffsetLeaves", () => {
  it("counts only Offset-type days per assignee across all sprints", () => {
    expect(countOffsetLeaves(ALL_LEAVES)).toEqual({ Alice: 2, Carol: 1 }); // Bob has only a Holiday
  });

  it("returns {} for an empty store", () => {
    expect(countOffsetLeaves({})).toEqual({});
  });
});

describe("computeOffsetWallet", () => {
  // stored spent/balance in the ledger are deliberately wrong to prove they're ignored.
  const ledger: OffsetLedger = {
    Alice: { earned: 3, spent: 99, manualAdjust: 1, balance: -95 },
    Bob: { earned: 1, spent: 0, manualAdjust: 0, balance: 1 },
  };

  it("balance = banked earned − DERIVED spent (from Offset leaves) + manual", () => {
    const w = computeOffsetWallet(ledger, ALL_LEAVES);
    // Alice: earned 3, spent 2 (derived, not the stored 99), manual 1 → 3 − 2 + 1 = 2
    expect(w.Alice).toEqual({ earned: 3, spent: 2, manual: 1, balance: 2 });
    // Bob: earned 1, no offset leaves → 1
    expect(w.Bob).toEqual({ earned: 1, spent: 0, manual: 0, balance: 1 });
  });

  it("includes a developer who spent but never earned (negative balance)", () => {
    const w = computeOffsetWallet(ledger, ALL_LEAVES);
    expect(w.Carol).toEqual({ earned: 0, spent: 1, manual: 0, balance: -1 });
  });

  it("handles a null ledger (all earned/manual = 0, spend still derived)", () => {
    const w = computeOffsetWallet(null, ALL_LEAVES);
    expect(w.Alice.balance).toBe(-2); // 0 − 2 + 0
    expect(w.Carol.balance).toBe(-1);
  });
});

describe("buildOffsetHistory", () => {
  const ledger: OffsetLedger = {
    Alice: { earned: 3, spent: 99, manualAdjust: 1, balance: -95 },
  };
  const names = { "1": "Sprint One", "2": "Sprint Two" };

  it("returns the standing + every Offset leave (newest first) with sprint names", () => {
    const h = buildOffsetHistory("Alice", ledger, ALL_LEAVES, names);
    expect(h.earned).toBe(3);
    expect(h.spent).toBe(2);
    expect(h.manual).toBe(1);
    expect(h.balance).toBe(2);
    expect(h.usage).toEqual([
      { date: "2026-06-10", sprintId: 2, sprintName: "Sprint Two" }, // newest first
      { date: "2026-06-02", sprintId: 1, sprintName: "Sprint One" },
    ]);
  });

  it("has empty usage for a developer who never used an offset", () => {
    const h = buildOffsetHistory("Bob", ledger, ALL_LEAVES);
    expect(h.usage).toEqual([]);
    expect(h.spent).toBe(0);
  });
});
