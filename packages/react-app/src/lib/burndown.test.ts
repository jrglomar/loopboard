// burndown.ts — pure burndown math (v1.42, ADR-052). Keyless/offline.

import { describe, it, expect } from "vitest";
import { computeBurndown } from "./burndown";

// Mon 2026-06-01 … Fri 2026-06-05 (5 working days)
const WEEK = ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05"];

describe("computeBurndown", () => {
  it("burns points on each resolution date (cumulative)", () => {
    const s = computeBurndown(
      10,
      [
        { storyPoints: 3, resolvedAt: "2026-06-02T15:00:00.000+0000" },
        { storyPoints: 2, resolvedAt: "2026-06-04T09:00:00.000+0000" },
      ],
      WEEK,
      "2026-06-05"
    );
    expect(s.days.map((d) => d.remaining)).toEqual([10, 7, 7, 5, 5]);
    expect(s.hasActual).toBe(true);
  });

  it("the ideal line runs committed → 0 linearly", () => {
    const s = computeBurndown(10, [], WEEK, "2026-06-05");
    expect(s.days.map((d) => d.ideal)).toEqual([10, 7.5, 5, 2.5, 0]);
  });

  it("days after `today` have remaining null (active sprint = partial line)", () => {
    const s = computeBurndown(8, [{ storyPoints: 2, resolvedAt: "2026-06-01T12:00:00Z" }], WEEK, "2026-06-02");
    expect(s.days.map((d) => d.remaining)).toEqual([6, 6, null, null, null]);
  });

  it("weekend resolutions roll into the next working day; pre-sprint ones into day 1", () => {
    const week2 = ["2026-06-08", "2026-06-09"]; // Mon, Tue
    const s = computeBurndown(
      5,
      [
        { storyPoints: 1, resolvedAt: "2026-06-06T10:00:00Z" }, // Saturday before
        { storyPoints: 2, resolvedAt: "2026-05-20T10:00:00Z" }, // long before the sprint
      ],
      week2,
      "2026-06-09"
    );
    expect(s.days.map((d) => d.remaining)).toEqual([2, 2]);
  });

  it("unresolved / unestimated issues never burn; remaining clamps at 0", () => {
    const s = computeBurndown(
      2,
      [
        { storyPoints: 5, resolvedAt: "2026-06-01T10:00:00Z" }, // burns more than committed
        { storyPoints: 3, resolvedAt: null },
        { storyPoints: null, resolvedAt: "2026-06-02T10:00:00Z" },
      ],
      WEEK,
      "2026-06-05"
    );
    expect(s.days[0]!.remaining).toBe(0); // clamped
    expect(s.days[4]!.remaining).toBe(0);
  });

  it("returns an empty series when the sprint has no working days", () => {
    const s = computeBurndown(10, [], [], "2026-06-05");
    expect(s.days).toEqual([]);
    expect(s.hasActual).toBe(false);
  });
});
