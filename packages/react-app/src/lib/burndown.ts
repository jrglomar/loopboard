// burndown.ts — pure sprint-burndown math (v1.42, ADR-052). No side effects; unit-tested.
//
// remaining(day) = committedPoints − Σ points of issues RESOLVED on-or-before that working day.
// Known limits (documented in CONTRACTS §changelog 156): the baseline is the CURRENT committed
// total (scope creep isn't re-based per day), and issues that count as "complete" via the
// code-review DoD burn down only when Jira actually marks them resolved.

export interface BurndownInputIssue {
  storyPoints: number | null;
  resolvedAt?: string | null;
}

export interface BurndownDay {
  /** Working day, YYYY-MM-DD. */
  date: string;
  /** Points remaining at END of this day; null for days after `today` (not happened yet). */
  remaining: number | null;
  /** The ideal linear committed→0 value for this day. */
  ideal: number;
}

export interface BurndownSeries {
  committed: number;
  days: BurndownDay[];
  /** True when at least one remaining value exists (something to draw). */
  hasActual: boolean;
}

/**
 * Compute the burndown series over the sprint's working days.
 *
 * @param committedPoints  the sprint's committed points (baseline)
 * @param completedIssues  issues counting toward completion (report.completed)
 * @param workingDays      sprint working days (from sprintWorkingDays), ascending
 * @param today            YYYY-MM-DD — days after this get remaining: null (future)
 */
export function computeBurndown(
  committedPoints: number,
  completedIssues: BurndownInputIssue[],
  workingDays: string[],
  today: string
): BurndownSeries {
  const n = workingDays.length;
  if (n === 0) return { committed: committedPoints, days: [], hasActual: false };

  // Points resolved per calendar day (date-only). Resolutions BEFORE the sprint start
  // count on the first working day; unresolved issues never burn.
  const firstDay = workingDays[0]!;
  const resolvedPerDay = new Map<string, number>();
  for (const issue of completedIssues) {
    if (!issue.resolvedAt) continue;
    const pts = issue.storyPoints ?? 0;
    if (pts === 0) continue;
    let d = issue.resolvedAt.slice(0, 10);
    if (d < firstDay) d = firstDay;
    resolvedPerDay.set(d, (resolvedPerDay.get(d) ?? 0) + pts);
  }

  const days: BurndownDay[] = [];
  let burned = 0;
  let cursor = 0; // index into a sorted list of resolution dates ≤ current working day
  const resolutionDates = [...resolvedPerDay.keys()].sort();

  let hasActual = false;
  for (let i = 0; i < n; i++) {
    const date = workingDays[i]!;
    // accumulate every resolution date up to and including this working day
    // (weekend resolutions roll into the next working day).
    while (cursor < resolutionDates.length && resolutionDates[cursor]! <= date) {
      burned += resolvedPerDay.get(resolutionDates[cursor]!)!;
      cursor++;
    }
    const ideal = n === 1 ? 0 : committedPoints * (1 - i / (n - 1));
    const isFuture = date > today;
    const remaining = isFuture ? null : Math.max(0, committedPoints - burned);
    if (remaining !== null) hasActual = true;
    days.push({ date, remaining, ideal: Math.round(ideal * 100) / 100 });
  }

  return { committed: committedPoints, days, hasActual };
}
