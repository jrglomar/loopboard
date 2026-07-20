import { describe, it, expect } from "vitest";
import {
  computeProgress,
  computeTimeline,
  computePace,
  remainingByStatus,
} from "./sprintMetrics";

// ── remainingByStatus (v1.40, ADR-050) ────────────────────────────────────────

describe("remainingByStatus", () => {
  it("splits not-completed points into todo vs in-progress", () => {
    const out = remainingByStatus([
      { statusCategory: "todo", storyPoints: 3 },
      { statusCategory: "todo", storyPoints: 2 },
      { statusCategory: "inprogress", storyPoints: 5 },
      { statusCategory: "inprogress", storyPoints: null }, // unestimated → 0
    ]);
    expect(out).toEqual({ todo: 5, inprogress: 5 });
  });

  it("returns zeros for an empty list and ignores unexpected categories", () => {
    expect(remainingByStatus([])).toEqual({ todo: 0, inprogress: 0 });
    expect(remainingByStatus([{ statusCategory: "done", storyPoints: 8 }])).toEqual({ todo: 0, inprogress: 0 });
  });
});

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

// ── computeTimeline (v1.65, ADR-077: working days, not calendar days) ──────────

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

  it("returns null when end <= start", () => {
    // Invalid sprint dates
    expect(computeTimeline("2026-06-14", "2026-06-01")).toBeNull();
  });

  it("returns null when the sprint spans zero working days (weekend-only)", () => {
    // 2026-06-06 = Sat, 2026-06-07 = Sun — end > start but no Mon–Fri day in range
    expect(computeTimeline("2026-06-06", "2026-06-07")).toBeNull();
  });

  // Standard fixture: Mon 2026-06-01 -> Fri 2026-06-12, a typical 2-week / 10-working-day
  // sprint. Same start/end already proven Mon–Fri-correct by capacity.test.ts's "counts
  // correct working days for a typical 2-week sprint (10 days)". endDate is INCLUSIVE —
  // the sprint's actual last day, same convention `sprintWorkingDays` and every other
  // consumer (burndown, capacity, reports) already use for report.sprint.startDate/endDate.
  const SPRINT_START = "2026-06-01"; // Mon
  const SPRINT_END = "2026-06-12"; // Fri (inclusive)

  it("dayOfN=1 / totalDays=10 on the start Monday (time-of-day within the day doesn't matter)", () => {
    // now = same calendar day as start, at noon — proves the comparison is date-only
    const result = computeTimeline(SPRINT_START, SPRINT_END, new Date("2026-06-01T12:00:00.000Z"));
    expect(result).not.toBeNull();
    expect(result!.dayOfN).toBe(1);
    expect(result!.totalDays).toBe(10);
    expect(result!.elapsedPct).toBe(10);
  });

  it("dayOfN=5 / elapsedPct=50 at the Friday ending the first working week", () => {
    const result = computeTimeline(SPRINT_START, SPRINT_END, new Date("2026-06-05T00:00:00.000Z"));
    expect(result).not.toBeNull();
    expect(result!.dayOfN).toBe(5);
    expect(result!.totalDays).toBe(10);
    expect(result!.elapsedPct).toBe(50);
    expect(result!.daysLeft).toBe(5);
  });

  it("Monday-start 2-week sprint: Day 10 on the final Friday, daysLeft 0 there", () => {
    const result = computeTimeline(SPRINT_START, SPRINT_END, new Date("2026-06-12T00:00:00.000Z"));
    expect(result).not.toBeNull();
    expect(result!.dayOfN).toBe(10);
    expect(result!.totalDays).toBe(10);
    expect(result!.daysLeft).toBe(0);
    expect(result!.elapsedPct).toBe(100);
  });

  it("stays capped at totalDays / 0 left once the sprint has fully passed", () => {
    const result = computeTimeline(SPRINT_START, SPRINT_END, new Date("2026-07-01T00:00:00.000Z"));
    expect(result).not.toBeNull();
    expect(result!.dayOfN).toBe(10);
    expect(result!.daysLeft).toBe(0);
    expect(result!.elapsedPct).toBe(100);
  });

  it("returns dayOfN=0 when now is before the sprint starts", () => {
    const result = computeTimeline(SPRINT_START, SPRINT_END, new Date("2026-05-25T00:00:00.000Z"));
    expect(result).not.toBeNull();
    expect(result!.dayOfN).toBe(0);
    expect(result!.totalDays).toBe(10);
    expect(result!.daysLeft).toBe(10);
    expect(result!.elapsedPct).toBe(0);
  });

  it("returns dayOfN=totalDays / daysLeft=0 when now is after the sprint ends", () => {
    const result = computeTimeline(SPRINT_START, SPRINT_END, new Date("2026-06-20T00:00:00.000Z"));
    expect(result).not.toBeNull();
    expect(result!.dayOfN).toBe(10);
    expect(result!.daysLeft).toBe(0);
  });

  it("mid-sprint weekday sanity: the second Wednesday is working Day 8 of 10", () => {
    // 2026-06-10 is the second Wed of the sprint (WD1-5 = Jun1-5, WD6-8 = Jun8-10)
    const result = computeTimeline(SPRINT_START, SPRINT_END, new Date("2026-06-10T00:00:00.000Z"));
    expect(result).not.toBeNull();
    expect(result!.dayOfN).toBe(8);
    expect(result!.totalDays).toBe(10);
  });

  it("weekend clamp: Saturday and Sunday give the same dayOfN (and elapsedPct) as the preceding Friday", () => {
    const friday   = computeTimeline(SPRINT_START, SPRINT_END, new Date("2026-06-05T00:00:00.000Z"));
    const saturday = computeTimeline(SPRINT_START, SPRINT_END, new Date("2026-06-06T00:00:00.000Z"));
    const sunday   = computeTimeline(SPRINT_START, SPRINT_END, new Date("2026-06-07T00:00:00.000Z"));
    expect(friday!.dayOfN).toBe(5);
    expect(saturday!.dayOfN).toBe(5); // no phantom weekend progress
    expect(sunday!.dayOfN).toBe(5);
    expect(saturday!.elapsedPct).toBe(friday!.elapsedPct);
    expect(sunday!.elapsedPct).toBe(friday!.elapsedPct);
  });

  // The user's live-reported bug (v1.65, ADR-077): the Huddle showed "Day 4 of 13 · 10
  // days left" for a sprint whose calendar day-4 fell on a Saturday. Fixture: Wed
  // 2026-07-01 -> Tue 2026-07-14 (10 working days: Jul 1-3, 6-10, 13-14), now = Sat
  // 2026-07-04 (the sprint's first Saturday — its 4th CALENDAR day). Under the OLD
  // calendar-day formula this exact start/end/now reproduces the reported numbers
  // exactly: totalDays = round((Jul14-Jul1)/day) = 13, elapsedDays = floor(3 days) = 3,
  // dayOfN = elapsedDays+1 = 4, daysLeft = 13-3 = 10 -> "Day 4 of 13 · 10 days left".
  // The fix must show working Day 3 of 10.
  it("the user's live case: calendar day-4 on a Saturday now reads as working Day 3 of 10", () => {
    const result = computeTimeline(
      "2026-07-01", // Wed
      "2026-07-14", // Tue (inclusive last working day)
      new Date("2026-07-04T00:00:00.000Z") // Sat — the sprint's 4th calendar day
    );
    expect(result).not.toBeNull();
    expect(result!.dayOfN).toBe(3);
    expect(result!.totalDays).toBe(10);
    expect(result!.daysLeft).toBe(7);
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

// ── computeTimeline -> computePace integration (v1.65, ADR-077) ────────────────

describe("computePace fed by the working-day timeline (v1.65, ADR-077)", () => {
  it("flips the pace bucket vs. the old calendar-day fraction on a weekend now", () => {
    // Same live-case fixture as the computeTimeline suite above: Wed 2026-07-01 ->
    // Tue 2026-07-14, now = Sat 2026-07-04. New working-day elapsedPct = 30% (3 of 10
    // working days elapsed). The OLD calendar-day formula would have given elapsedPct
    // = round(3/13*100) = 23% (3 calendar days into a 13-calendar-day span) — hand
    // -derived here since the buggy calendar formula no longer exists in the codebase
    // to call directly.
    const timeline = computeTimeline(
      "2026-07-01",
      "2026-07-14",
      new Date("2026-07-04T00:00:00.000Z")
    );
    expect(timeline).not.toBeNull();
    expect(timeline!.elapsedPct).toBe(30); // working-day fraction

    const oldCalendarElapsedPct = 23; // round(3/13*100), derivation documented above

    // At 15% points done: delta vs the new working-day fraction (30) = -15 -> "behind"
    // (computePace's real threshold: delta < -10). Delta vs the old calendar fraction
    // (23) = -8 -> "on_track" (real threshold: -10 <= delta <= 10). The old calendar
    // -based pace would have hidden a team that is genuinely behind.
    expect(computePace(timeline!.elapsedPct, 15)).toBe("behind");
    expect(computePace(oldCalendarElapsedPct, 15)).toBe("on_track");
  });
});
