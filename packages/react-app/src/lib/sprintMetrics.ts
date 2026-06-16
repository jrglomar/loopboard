/**
 * Sprint progress + pace pure functions (v1.3, ADR-010).
 * Derives from totals and sprint.startDate/endDate + client clock.
 * NO network calls, NO side effects.
 */

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
  /** 1-based day within the sprint */
  dayOfN: number;
  /** Total calendar days in the sprint */
  totalDays: number;
  /** Days remaining (0 when elapsed ≥ total) */
  daysLeft: number;
  /** Percentage 0–100 of sprint time elapsed */
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

// ── computeTimeline ───────────────────────────────────────────────────────────

/**
 * Compute sprint timeline position from start/end dates and current time.
 * Returns null when either date is missing.
 *
 * @param startDate - ISO date string or null
 * @param endDate   - ISO date string or null
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

  const totalMs = end.getTime() - start.getTime();
  const elapsedMs = Math.max(0, now.getTime() - start.getTime());

  const totalDays = Math.round(totalMs / (1000 * 60 * 60 * 24));
  const elapsedDays = Math.min(
    totalDays,
    Math.floor(elapsedMs / (1000 * 60 * 60 * 24))
  );

  // dayOfN is 1-based; cap at totalDays
  const dayOfN = Math.min(totalDays, elapsedDays + 1);
  const daysLeft = Math.max(0, totalDays - elapsedDays);
  const elapsedPct = Math.min(100, Math.round((elapsedMs / totalMs) * 100));

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
 * @param elapsedPct  - % of sprint time elapsed (0–100), or null
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
