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
    expect(w.Alice).toEqual({ earned: 3, spent: 2, manual: 1, adjustmentsTotal: 0, balance: 2 });
    // Bob: earned 1, no offset leaves → 1
    expect(w.Bob).toEqual({ earned: 1, spent: 0, manual: 0, adjustmentsTotal: 0, balance: 1 });
  });

  it("folds the manual-adjustment log into the balance (v1.54, ADR-065)", () => {
    const withAdj: OffsetLedger = {
      Alice: {
        earned: 3, spent: 0, manualAdjust: 1, balance: 0,
        adjustments: [
          { id: "a", amount: 5, createdAt: "2026-07-01T00:00:00Z" },
          { id: "b", amount: -2, note: "spent early", createdAt: "2026-07-02T00:00:00Z" },
        ],
      },
    };
    const w = computeOffsetWallet(withAdj, ALL_LEAVES);
    // earned 3 − spent 2 (derived) + opening 1 + adjustments (5 − 2) = 5
    expect(w.Alice).toEqual({ earned: 3, spent: 2, manual: 1, adjustmentsTotal: 3, balance: 5 });
  });

  it("includes a developer who spent but never earned (negative balance)", () => {
    const w = computeOffsetWallet(ledger, ALL_LEAVES);
    expect(w.Carol).toEqual({ earned: 0, spent: 1, manual: 0, adjustmentsTotal: 0, balance: -1 });
  });

  it("handles a null ledger (all earned/manual = 0, spend still derived)", () => {
    const w = computeOffsetWallet(null, ALL_LEAVES);
    expect(w.Alice.balance).toBe(-2); // 0 − 2 + 0
    expect(w.Carol.balance).toBe(-1);
  });

  it("handles DECIMAL earned / opening / adjustments (v1.55, ADR-066)", () => {
    const dec: OffsetLedger = {
      Dana: {
        earned: 2.5, spent: 0, manualAdjust: 0.5, balance: 0,
        adjustments: [{ id: "x", amount: 0.25, createdAt: "2026-07-01T00:00:00Z" }],
      },
    };
    const w = computeOffsetWallet(dec, {}); // no leaves → spent 0
    expect(w.Dana).toEqual({ earned: 2.5, spent: 0, manual: 0.5, adjustmentsTotal: 0.25, balance: 3.25 });
  });
});

describe("buildOffsetHistory", () => {
  const ledger: OffsetLedger = {
    Alice: {
      earned: 3, spent: 99, manualAdjust: 1, balance: -95,
      bySprint: { "1": { earned: 1, spent: 0 }, "2": { earned: 2, spent: 1 }, "3": { earned: 0, spent: 0 } },
      adjustments: [
        { id: "adj2", amount: -1, note: "used offline", createdAt: "2026-07-05T00:00:00Z" },
        { id: "adj1", amount: 4, note: "carry-in", createdAt: "2026-07-01T00:00:00Z" },
      ],
    },
  };
  const names = { "1": "Sprint One", "2": "Sprint Two" };

  it("returns the standing + every Offset leave (newest first) with sprint names", () => {
    const h = buildOffsetHistory("Alice", ledger, ALL_LEAVES, names);
    expect(h.earned).toBe(3);
    expect(h.spent).toBe(2);
    expect(h.manual).toBe(1);
    expect(h.adjustmentsTotal).toBe(3); // 4 − 1
    expect(h.balance).toBe(5); // 3 − 2 + 1 + 3
    expect(h.usage).toEqual([
      { date: "2026-06-10", sprintId: 2, sprintName: "Sprint Two" }, // newest first
      { date: "2026-06-02", sprintId: 1, sprintName: "Sprint One" },
    ]);
  });

  it("plots banked EARNED per sprint (only earned > 0), newest sprint first (v1.54)", () => {
    const h = buildOffsetHistory("Alice", ledger, ALL_LEAVES, names);
    expect(h.earnedBySprint).toEqual([
      { sprintId: 2, sprintName: "Sprint Two", earned: 2 }, // sprint 3 (earned 0) is excluded
      { sprintId: 1, sprintName: "Sprint One", earned: 1 },
    ]);
  });

  it("passes through the manual-adjustment log (newest-first as stored) (v1.54)", () => {
    const h = buildOffsetHistory("Alice", ledger, ALL_LEAVES, names);
    expect(h.adjustments.map((a) => a.id)).toEqual(["adj2", "adj1"]);
  });

  it("has empty usage/earned/adjustments for a developer with no activity", () => {
    const h = buildOffsetHistory("Bob", ledger, ALL_LEAVES);
    expect(h.usage).toEqual([]);
    expect(h.earnedBySprint).toEqual([]);
    expect(h.adjustments).toEqual([]);
    expect(h.spent).toBe(0);
  });
});
