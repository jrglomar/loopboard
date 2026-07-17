// aging.ts unit tests — Work Item Age vs a points-scaled expectation (v1.58, ADR-070).
// Pure; `today` injected so the math is deterministic. Keyless/offline.

import { describe, it, expect } from "vitest";
import { computeAging, agingDetail, tierFor, daysSince, toUtcMidnight } from "./aging";
import type { IssueSummary, AgingPolicy } from "./types";

const TODAY = "2026-07-16";
const POLICY: AgingPolicy = { baseDays: 1, daysPerPoint: 1 }; // 3 pts → expect 4d

function issue(over: Partial<IssueSummary> = {}): IssueSummary {
  return {
    key: "DEV-1", summary: "Thing", status: "In Progress", statusCategory: "inprogress",
    assignee: "Alice", assigneeAccountId: "a1", storyPoints: 3, issueType: "Task",
    url: "https://j/browse/DEV-1", blocked: false, inProgressSince: `${TODAY}T00:00:00.000Z`,
    ...over,
  };
}

/** An issue that entered its status `n` days before TODAY. */
function aged(n: number, over: Partial<IssueSummary> = {}): IssueSummary {
  const d = new Date(Date.UTC(2026, 6, 16 - n));
  return issue({ inProgressSince: d.toISOString(), ...over });
}

// v1.60 (ADR-072): daysSince/toUtcMidnight relocated here from the now-deleted nudge-card helper
// module (their only remaining consumer). Direct pin tests for the UTC-midnight calendar-day
// convention — previously exercised only indirectly (via the now-removed nudge-list builder).
describe("daysSince / toUtcMidnight (relocated, v1.60 ADR-072)", () => {
  it("toUtcMidnight collapses any time-of-day to the same UTC-midnight epoch", () => {
    expect(toUtcMidnight("2026-07-16T23:59:59.999Z")).toBe(toUtcMidnight("2026-07-16T00:00:00.000Z"));
  });

  it("daysSince counts whole calendar days between an ISO timestamp and today", () => {
    expect(daysSince("2026-07-10T00:00:00.000Z", TODAY)).toBe(6);
  });

  it("daysSince treats the same calendar day as 0, regardless of time-of-day", () => {
    expect(daysSince(`${TODAY}T23:00:00.000Z`, TODAY)).toBe(0);
  });

  it("daysSince is negative for a timestamp after today (future)", () => {
    expect(daysSince("2026-07-20T00:00:00.000Z", TODAY)).toBe(-4);
  });
});

describe("tierFor (thresholds)", () => {
  it("is ok below 100% of the expectation", () => {
    expect(tierFor(0.99)).toBe("ok");
  });
  it("is watch at EXACTLY 100% and up to 150%", () => {
    expect(tierFor(1)).toBe("watch");
    expect(tierFor(1.49)).toBe("watch");
  });
  it("is overdue at EXACTLY 150% and beyond", () => {
    expect(tierFor(1.5)).toBe("overdue");
    expect(tierFor(9)).toBe("overdue");
  });
});

describe("computeAging", () => {
  it("scales the expectation by story points (base + perPoint × pts)", () => {
    const { entries } = computeAging([aged(2, { storyPoints: 3 })], POLICY, TODAY);
    expect(entries[0]!.ageDays).toBe(2);
    expect(entries[0]!.expectedDays).toBe(4); // 1 + 1×3
    expect(entries[0]!.ratio).toBe(0.5);
    expect(entries[0]!.tier).toBe("ok");
  });

  it("flags a small ticket that has sat too long, but not a big one at the same age", () => {
    const { entries } = computeAging(
      [aged(5, { key: "SMALL", storyPoints: 1 }), aged(5, { key: "BIG", storyPoints: 13 })],
      POLICY,
      TODAY
    );
    const small = entries.find((e) => e.key === "SMALL")!;
    const big = entries.find((e) => e.key === "BIG")!;
    expect(small.tier).toBe("overdue"); // 5d vs expected 2d = 250%
    expect(big.tier).toBe("ok"); // 5d vs expected 14d = 36%
  });

  it("treats an unpointed ticket as base-only and flags it", () => {
    const { entries } = computeAging([aged(3, { storyPoints: null })], POLICY, TODAY);
    expect(entries[0]!.unpointed).toBe(true);
    expect(entries[0]!.expectedDays).toBe(1); // base only
    expect(entries[0]!.tier).toBe("overdue"); // 3d vs 1d
  });

  it("sorts worst-first by ratio", () => {
    const { entries } = computeAging(
      [aged(1, { key: "A", storyPoints: 5 }), aged(8, { key: "B", storyPoints: 1 }), aged(3, { key: "C", storyPoints: 3 })],
      POLICY,
      TODAY
    );
    expect(entries.map((e) => e.key)).toEqual(["B", "C", "A"]);
  });

  it("EXCLUDES issues with no known start (never guesses an age)", () => {
    const { entries } = computeAging(
      [issue({ key: "KNOWN" }), issue({ key: "UNKNOWN", inProgressSince: null }), issue({ key: "ABSENT", inProgressSince: undefined })],
      POLICY,
      TODAY
    );
    expect(entries.map((e) => e.key)).toEqual(["KNOWN"]);
  });

  it("excludes done issues even when they carry a start date", () => {
    const { entries } = computeAging([aged(9, { statusCategory: "done", status: "Done" })], POLICY, TODAY);
    expect(entries).toEqual([]);
  });

  it("counts the tiers", () => {
    const { okCount, watchCount, overdueCount } = computeAging(
      [
        aged(1, { key: "A", storyPoints: 5 }), // 1/6 → ok
        aged(4, { key: "B", storyPoints: 3 }), // 4/4 → watch
        aged(9, { key: "C", storyPoints: 1 }), // 9/2 → overdue
      ],
      POLICY,
      TODAY
    );
    expect({ okCount, watchCount, overdueCount }).toEqual({ okCount: 1, watchCount: 1, overdueCount: 1 });
  });

  it("guards a degenerate all-zero policy (no divide-by-zero NaN)", () => {
    const zero: AgingPolicy = { baseDays: 0, daysPerPoint: 0 };
    const { entries } = computeAging([aged(2), aged(0, { key: "TODAY-START" })], zero, TODAY);
    expect(entries[0]!.ratio).toBe(Infinity);
    expect(entries[0]!.tier).toBe("overdue");
    expect(entries.find((e) => e.key === "TODAY-START")!.ratio).toBe(0);
  });

  it("floors a future start date at 0 days rather than going negative", () => {
    const { entries } = computeAging([issue({ inProgressSince: "2026-07-20T00:00:00.000Z" })], POLICY, TODAY);
    expect(entries[0]!.ageDays).toBe(0);
  });
});

describe("agingDetail", () => {
  it("reads naturally for a pointed ticket", () => {
    const { entries } = computeAging([aged(5, { status: "Code Review", storyPoints: 3 })], POLICY, TODAY);
    expect(agingDetail(entries[0]!)).toBe("5d in Code Review (expected ~4d for 3 pts)");
  });

  it("singularizes 1 pt and calls out a missing estimate", () => {
    const one = computeAging([aged(1, { storyPoints: 1 })], POLICY, TODAY).entries[0]!;
    expect(agingDetail(one)).toContain("for 1 pt)");
    const none = computeAging([aged(1, { storyPoints: null })], POLICY, TODAY).entries[0]!;
    expect(agingDetail(none)).toContain("no estimate");
  });
});
