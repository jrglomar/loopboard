/**
 * Sprint progress + pace pure functions (v1.3, ADR-010).
 * Derives from totals and sprint.startDate/endDate + client clock.
 * NO network calls, NO side effects.
 */

import { sprintWorkingDays } from "./capacity";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProgressResult {
  /** Percentage 0–100 of story points done vs total; null when no estimates */
  pointsPct: number | null;
  /** Percentage 0–100 of issues done vs total */
  issuesPct: number | null;
  /** True when storyPointsTotal > 0 */
  hasEstimates: boolean;
  /** Issues done count */
  issuesDone: number;
  /** Issues total count */
  issuesTotal: number;
}

export interface TimelineResult {
  /**
   * 1-based WORKING day (Mon–Fri) within the sprint (v1.65, ADR-077) — count of the
   * sprint's working days that are <= today. 0 before the sprint's first working day;
   * capped at totalDays once today is on/after the last working day. NOT a calendar
   * day number — a weekend `now` clamps to the preceding Friday's count.
   */
  dayOfN: number;
  /** Total WORKING days (Mon–Fri) in the sprint — from `sprintWorkingDays`, NOT calendar days (v1.65, ADR-077) */
  totalDays: number;
  /** Working days remaining strictly AFTER today = totalDays − dayOfN (0 on/after the last working day) */
  daysLeft: number;
  /** Percentage 0–100 of sprint WORKING days elapsed (dayOfN / totalDays); feeds computePace (v1.65, ADR-077) */
  elapsedPct: number;
}

export type PaceStatus = "on_track" | "behind" | "ahead";

// ── computeProgress ───────────────────────────────────────────────────────────

/**
 * Compute sprint story-point and issue progress percentages.
 *
 * v1.5 DoD (ADR-014): "completed" points = storyPointsDone + storyPointsCodeReview.
 * Code Review issues count as done for progress/pace; the board still shows them
 * as their own column. When storyPointsTotal === 0, returns "No estimates" state.
 *
 * @param totals - The totals object from get_active_sprint output
 */
export function computeProgress(totals: {
  storyPointsDone: number;
  storyPointsCodeReview?: number; // v1.5 — optional for backward compat with tests
  storyPointsTotal: number;
  done: number;
  total: number;
}): ProgressResult {
  const hasEstimates = totals.storyPointsTotal > 0;

  // DoD: done + code-review counts as completed (ADR-014)
  const completedPoints = totals.storyPointsDone + (totals.storyPointsCodeReview ?? 0);

  const pointsPct = hasEstimates
    ? Math.round((completedPoints / totals.storyPointsTotal) * 100)
    : null;

  const issuesPct =
    totals.total > 0
      ? Math.round((totals.done / totals.total) * 100)
      : null;

  return {
    pointsPct,
    issuesPct,
    hasEstimates,
    issuesDone: totals.done,
    issuesTotal: totals.total,
  };
}

// ── computeTimeline (v1.65, ADR-077: working days, not calendar days) ──────────

/**
 * Compute sprint timeline position in WORKING days (Mon–Fri) from start/end dates and
 * the current time. Built on the SAME `sprintWorkingDays` list that burndown and capacity
 * already consume — one working-day convention for the whole app, no third copy.
 *
 * dayOfN = count of the sprint's working days that are <= today (date-only comparison,
 * UTC). On a weekend `now`, this naturally equals the preceding Friday's count — no
 * phantom weekend progress, no special-cased branch needed. daysLeft = totalDays − dayOfN,
 * i.e. remaining working days strictly AFTER today (today, once counted in dayOfN, is
 * excluded from "left" — the sprint's final working day shows 0 left).
 *
 * Returns null when either date is missing/invalid, end <= start, or the sprint contains
 * zero working days (e.g. a start/end that both fall on the same weekend).
 *
 * @param startDate - ISO date string or null
 * @param endDate   - ISO date string or null (inclusive — the sprint's actual last day,
 *                    same convention `sprintWorkingDays` and every other consumer use)
 * @param now       - Current Date (injected for testability; defaults to new Date())
 */
export function computeTimeline(
  startDate: string | null,
  endDate: string | null,
  now: Date = new Date()
): TimelineResult | null {
  if (!startDate || !endDate) return null;

  const start = new Date(startDate);
  const end = new Date(endDate);

  // Guard: if dates are invalid or end <= start, return null
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) return null;

  const workingDays = sprintWorkingDays(startDate, endDate);
  const totalDays = workingDays.length;
  // Guard: sprint spans zero working days (e.g. start/end both fall on one weekend)
  if (totalDays === 0) return null;

  const today = now.toISOString().slice(0, 10);
  const dayOfN = workingDays.filter((d) => d <= today).length;

  const daysLeft = totalDays - dayOfN;
  const elapsedPct = Math.min(100, Math.round((dayOfN / totalDays) * 100));

  return { dayOfN, totalDays, daysLeft, elapsedPct };
}

// ── computePace ───────────────────────────────────────────────────────────────

/**
 * Heuristic pace indicator: compare % sprint time elapsed vs % story points done.
 *
 * Returns null when:
 * - no estimates (pointsPct is null)
 * - no timeline (elapsedPct is null)
 *
 * On-track: within ~10 percentage points of expected burn rate.
 * Behind: > 10pp behind expected.
 * Ahead: > 10pp ahead of expected.
 *
 * Clearly labeled as a heuristic — NOT a velocity forecast.
 *
 * @param elapsedPct  - % of sprint elapsed (0–100), or null — as of v1.65/ADR-077 this is
 *                      the WORKING-day fraction from `computeTimeline`, not calendar time
 * @param pointsPct   - % of story points done (0–100), or null
 */
export function computePace(
  elapsedPct: number | null,
  pointsPct: number | null
): PaceStatus | null {
  if (elapsedPct === null || pointsPct === null) return null;

  const delta = pointsPct - elapsedPct; // positive = ahead, negative = behind

  if (delta >= -10 && delta <= 10) return "on_track";
  if (delta < -10) return "behind";
  return "ahead";
}

// ── remainingByStatus (v1.40, ADR-050) ────────────────────────────────────────

export interface RemainingByStatus {
  todo: number;
  inprogress: number;
}

/**
 * Split the NOT-completed points of a sprint report by raw status category (v1.40, ADR-050).
 * Feeds the Completion Summary's "remaining" row. Only todo/inprogress can appear here:
 * per the DoD (ADR-014) code-review issues count as COMPLETED, and statusCategory is Jira's
 * raw category. Unestimated issues count 0.
 */
export function remainingByStatus(
  notCompleted: Array<{ statusCategory: string; storyPoints: number | null }>
): RemainingByStatus {
  const out: RemainingByStatus = { todo: 0, inprogress: 0 };
  for (const issue of notCompleted) {
    const pts = issue.storyPoints ?? 0;
    if (issue.statusCategory === "todo") out.todo += pts;
    else if (issue.statusCategory === "inprogress") out.inprogress += pts;
  }
  return out;
}
