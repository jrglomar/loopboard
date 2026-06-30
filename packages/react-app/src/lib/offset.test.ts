// offset.ts unit tests — v1.26, ADR-038. Pure; keyless/offline.

import { describe, it, expect } from "vitest";
import { leaveDaysByType, totalLeaveDays, computeOffsetEarned } from "./offset";
import type { AssigneeLeaves } from "./types";

const WORKING = ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05"];

describe("leaveDaysByType", () => {
  it("counts per type within the working days only", () => {
    const typed: AssigneeLeaves = {
      "2026-06-01": "VL",
      "2026-06-02": "VL",
      "2026-06-03": "Offset",
      "2026-06-06": "EL", // weekend / outside working days → ignored
    };
    expect(leaveDaysByType(typed, WORKING)).toEqual({ VL: 2, EL: 0, Holiday: 0, Offset: 1 });
  });

  it("totalLeaveDays sums all types on working days", () => {
    const typed: AssigneeLeaves = { "2026-06-01": "VL", "2026-06-02": "Holiday", "2026-06-03": "Offset" };
    expect(totalLeaveDays(typed, WORKING)).toBe(3);
  });
});

describe("computeOffsetEarned (cap 1/sprint)", () => {
  it("earns 1 when done + leaveDays reaches N + N2 (user example: 8 + 2 = 10, N=8 N2=2)", () => {
    expect(computeOffsetEarned(8, 2, 8, 2)).toBe(1);
  });

  it("earns 0 below the threshold", () => {
    expect(computeOffsetEarned(7, 2, 8, 2)).toBe(0); // 9 < 10
  });

  it("is capped at 1 even far above the threshold", () => {
    expect(computeOffsetEarned(20, 5, 8, 2)).toBe(1);
  });

  it("counts leave days toward the total (8 done + 2 leaves earns; 0 leaves does not)", () => {
    expect(computeOffsetEarned(8, 0, 8, 2)).toBe(0); // 8 < 10
    expect(computeOffsetEarned(8, 2, 8, 2)).toBe(1); // 10 >= 10
  });
});
