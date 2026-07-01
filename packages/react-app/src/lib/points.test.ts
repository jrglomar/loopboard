// points.ts — point-scale breakdown (v1.36, ADR-046). Pure, keyless, offline.
import { describe, it, expect } from "vitest";
import { ALLOWED_POINTS, isAllowedPoint, suggestBreakdown } from "./points";

describe("isAllowedPoint", () => {
  it("accepts every scale value (incl. sub-1)", () => {
    for (const p of ALLOWED_POINTS) expect(isAllowedPoint(p)).toBe(true);
  });
  it("rejects off-scale values", () => {
    for (const n of [0, 4, 6, 8, 10, 1.5, 2.5, 100]) expect(isAllowedPoint(n)).toBe(false);
  });
});

describe("suggestBreakdown", () => {
  it("keeps a single allowed estimate as one task", () => {
    for (const p of [0.2, 0.3, 0.5, 1, 2, 3, 5, 7]) {
      expect(suggestBreakdown(p)).toEqual([p]);
    }
  });

  it("splits an even total into a balanced pair (the headline cases)", () => {
    expect(suggestBreakdown(4)).toEqual([2, 2]);
    expect(suggestBreakdown(6)).toEqual([3, 3]);
    expect(suggestBreakdown(8)).toEqual([3, 5]);
    expect(suggestBreakdown(10)).toEqual([5, 5]);
  });

  it("returns ascending pairs summing to the total", () => {
    const parts = suggestBreakdown(8);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(8);
    expect([...parts].sort((a, b) => a - b)).toEqual(parts); // already ascending
  });

  it("keeps values ≤ 1 as a single task (no sub-splitting)", () => {
    expect(suggestBreakdown(1)).toEqual([1]);
    expect(suggestBreakdown(0.5)).toEqual([0.5]);
  });

  it("returns [] for invalid / non-positive totals", () => {
    expect(suggestBreakdown(0)).toEqual([]);
    expect(suggestBreakdown(-3)).toEqual([]);
    expect(suggestBreakdown(NaN)).toEqual([]);
  });

  it("approximates when no exact allowed pair sums to the total", () => {
    const parts = suggestBreakdown(9); // only exact allowed pair is 2+7
    expect(parts).toEqual([2, 7]);
    // a total with no exact pair still yields two allowed values
    const approx = suggestBreakdown(4.5);
    expect(approx).toHaveLength(2);
    for (const p of approx) expect(isAllowedPoint(p)).toBe(true);
  });
});
