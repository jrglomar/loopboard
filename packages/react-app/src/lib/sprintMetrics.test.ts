import { describe, it, expect } from "vitest";
import {
  computeProgress,
  computeTimeline,
  computePace,
} from "./sprintMetrics";

// ── computeProgress ───────────────────────────────────────────────────────────

describe("computeProgress", () => {
  it("returns pointsPct and issuesPct when estimates exist (no code-review pts)", () => {
    const result = computeProgress({
      storyPointsDone: 4,
      storyPointsTotal: 16,
      done: 3,
      total: 10,
    });
    expect(result.hasEstimates).toBe(true);
    expect(result.pointsPct).toBe(25); // 4/16 = 25%
    expect(result.issuesPct).toBe(30); // 3/10 = 30%
  });

  // v1.5 DoD (ADR-014): storyPointsCodeReview adds to completed points
  it("v1.5 DoD: includes storyPointsCodeReview in completed % (done=4 + review=4 = 8/16 = 50%)", () => {
    const result = computeProgress({
      storyPointsDone: 4,
      storyPointsCodeReview: 4,
      storyPointsTotal: 16,
      done: 3,
      total: 10,
    });
    expect(result.hasEstimates).toBe(true);
    expect(result.pointsPct).toBe(50); // (4+4)/16 = 50%
  });

  it("v1.5 DoD: storyPointsCodeReview=0 behaves identically to absent field", () => {
    const withZero = computeProgress({
      storyPointsDone: 4,
      storyPointsCodeReview: 0,
      storyPointsTotal: 16,
      done: 3,
      total: 10,
    });
    const withAbsent = computeProgress({
      storyPointsDone: 4,
      storyPointsTotal: 16,
      done: 3,
      total: 10,
    });
    expect(withZero.pointsPct).toBe(withAbsent.pointsPct); // both 25%
  });

  it("v1.5 DoD: 100% when done+review equals total points", () => {
    const result = computeProgress({
      storyPointsDone: 6,
      storyPointsCodeReview: 2,
      storyPointsTotal: 8,
      done: 4,
      total: 5,
    });
    expect(result.pointsPct).toBe(100);
  });

  it("returns pointsPct=null and hasEstimates=false when storyPointsTotal===0", () => {
    const result = computeProgress({
      storyPointsDone: 0,
      storyPointsCodeReview: 0,
      storyPointsTotal: 0,
      done: 2,
      total: 5,
    });
    expect(result.hasEstimates).toBe(false);
    expect(result.pointsPct).toBeNull();
    expect(result.issuesPct).toBe(40); // 2/5 = 40%
  });

  it("returns issuesPct=null when total===0", () => {
    const result = computeProgress({
      storyPointsDone: 0,
      storyPointsTotal: 0,
      done: 0,
      total: 0,
    });
    expect(result.issuesPct).toBeNull();
    expect(result.pointsPct).toBeNull();
  });

  it("rounds to nearest integer", () => {
    const result = computeProgress({
      storyPointsDone: 1,
      storyPointsTotal: 3,
      done: 1,
      total: 3,
    });
    // 1/3 = 33.33... → 33
    expect(result.pointsPct).toBe(33);
    expect(result.issuesPct).toBe(33);
  });

  it("returns 100% when all done (no code-review)", () => {
    const result = computeProgress({
      storyPointsDone: 8,
      storyPointsTotal: 8,
      done: 5,
      total: 5,
    });
    expect(result.pointsPct).toBe(100);
    expect(result.issuesPct).toBe(100);
  });

  it("includes issuesDone and issuesTotal passthrough", () => {
    const result = computeProgress({
      storyPointsDone: 4,
      storyPointsTotal: 16,
      done: 3,
      total: 10,
    });
    expect(result.issuesDone).toBe(3);
    expect(result.issuesTotal).toBe(10);
  });
});

// ── computeTimeline ───────────────────────────────────────────────────────────

describe("computeTimeline", () => {
  it("returns null when startDate is null", () => {
    expect(computeTimeline(null, "2026-06-14")).toBeNull();
  });

  it("returns null when endDate is null", () => {
    expect(computeTimeline("2026-06-01", null)).toBeNull();
  });

  it("returns null when both dates are null", () => {
    expect(computeTimeline(null, null)).toBeNull();
  });

  it("returns correct timeline at sprint start", () => {
    // Sprint: Jun 1–14 (14 days); now = Jun 1 (day 1)
    const start = "2026-06-01T00:00:00.000Z";
    const end   = "2026-06-15T00:00:00.000Z";
    const now   = new Date("2026-06-01T12:00:00.000Z");
    const result = computeTimeline(start, end, now);
    expect(result).not.toBeNull();
    expect(result!.dayOfN).toBe(1);
    expect(result!.totalDays).toBe(14);
    expect(result!.elapsedPct).toBeGreaterThanOrEqual(0);
  });

  it("returns correct timeline mid-sprint", () => {
    // Sprint: Jun 1–15 (14 days total); now = Jun 8 = day 7
    const start = "2026-06-01T00:00:00.000Z";
    const end   = "2026-06-15T00:00:00.000Z";
    const now   = new Date("2026-06-08T00:00:00.000Z");
    const result = computeTimeline(start, end, now);
    expect(result).not.toBeNull();
    expect(result!.elapsedPct).toBe(50);
    expect(result!.daysLeft).toBeGreaterThan(0);
  });

  it("caps elapsedPct at 100 when sprint has passed", () => {
    const start = "2026-06-01T00:00:00.000Z";
    const end   = "2026-06-14T00:00:00.000Z";
    const now   = new Date("2026-07-01T00:00:00.000Z"); // past end
    const result = computeTimeline(start, end, now);
    expect(result).not.toBeNull();
    expect(result!.elapsedPct).toBe(100);
    expect(result!.daysLeft).toBe(0);
  });

  it("returns null when end <= start", () => {
    // Invalid sprint dates
    expect(computeTimeline("2026-06-14", "2026-06-01")).toBeNull();
  });
});

// ── computePace ───────────────────────────────────────────────────────────────

describe("computePace", () => {
  it("returns null when elapsedPct is null", () => {
    expect(computePace(null, 50)).toBeNull();
  });

  it("returns null when pointsPct is null", () => {
    expect(computePace(50, null)).toBeNull();
  });

  it("returns null when both are null", () => {
    expect(computePace(null, null)).toBeNull();
  });

  it("returns on_track when within 10pp (exact match)", () => {
    expect(computePace(50, 50)).toBe("on_track");
  });

  it("returns on_track when slightly behind (within 10pp)", () => {
    expect(computePace(50, 42)).toBe("on_track"); // delta = -8
  });

  it("returns on_track when slightly ahead (within 10pp)", () => {
    expect(computePace(50, 58)).toBe("on_track"); // delta = +8
  });

  it("returns behind when more than 10pp behind", () => {
    expect(computePace(60, 40)).toBe("behind"); // delta = -20
  });

  it("returns ahead when more than 10pp ahead", () => {
    expect(computePace(40, 60)).toBe("ahead"); // delta = +20
  });

  it("returns on_track at exactly the 10pp boundary (behind)", () => {
    expect(computePace(50, 40)).toBe("on_track"); // delta = -10 (inclusive)
  });

  it("returns on_track at exactly the 10pp boundary (ahead)", () => {
    expect(computePace(50, 60)).toBe("on_track"); // delta = +10 (inclusive)
  });

  it("returns behind just outside the boundary", () => {
    expect(computePace(50, 39)).toBe("behind"); // delta = -11
  });

  it("returns ahead just outside the boundary", () => {
    expect(computePace(50, 61)).toBe("ahead"); // delta = +11
  });

  it("returns behind at sprint start with 0 points done", () => {
    // 20% into sprint, 0% done — delta = -20
    expect(computePace(20, 0)).toBe("behind");
  });

  it("returns ahead when all points done early", () => {
    // 30% into sprint, 100% done — delta = +70
    expect(computePace(30, 100)).toBe("ahead");
  });
});
