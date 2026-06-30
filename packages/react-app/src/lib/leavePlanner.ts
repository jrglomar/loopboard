// leavePlanner.ts (v1.29, ADR-041) — pure helpers for the forward, multi-sprint leave planner.
// No React, no network. Weekends are excluded by sprintWorkingDays (Mon–Fri only).

import { sprintWorkingDays } from "./capacity";
import type { SprintRef } from "./types";

export interface CalendarDay {
  date: string; // YYYY-MM-DD (Mon–Fri)
  sprintId: number;
}

export interface SprintSegment {
  sprintId: number;
  name: string;
  state: SprintRef["state"];
  startDate: string | null;
  endDate: string | null;
  /** Mon–Fri ISO dates that belong to this sprint (deduped against earlier sprints in the window). */
  days: string[];
}

export interface LeaveCalendar {
  days: CalendarDay[];
  segments: SprintSegment[];
  /** date (YYYY-MM-DD) → the sprint id that owns it (first sprint wins on overlap). */
  dateToSprintId: Record<string, number>;
}

/** Today as YYYY-MM-DD (UTC). */
function isoToday(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Pick the window of sprints for the forward leave planner: a few recent + the current + the next few,
 * date-ordered. Robust to boards with many never-closed "active" sprints — it anchors on the sprint
 * containing today (else the latest one already started, else the first upcoming), NOT on the state
 * label. Only sprints with both dates are considered.
 */
export function selectCalendarSprints(
  sprints: SprintRef[],
  opts: { before?: number; after?: number; today?: string } = {}
): SprintRef[] {
  const before = opts.before ?? 2;
  const after = opts.after ?? 4;
  const today = opts.today ?? isoToday(new Date());

  const dated = sprints
    .filter((s) => s.startDate && s.endDate)
    .map((s) => ({ s, start: s.startDate!.slice(0, 10), end: s.endDate!.slice(0, 10) }))
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  if (dated.length === 0) return [];

  let anchor = dated.findIndex((d) => d.start <= today && today <= d.end);
  if (anchor === -1) {
    let lastStarted = -1;
    for (let i = 0; i < dated.length; i++) if (dated[i]!.start <= today) lastStarted = i;
    anchor = lastStarted >= 0 ? lastStarted : 0; // none started yet → first upcoming
  }

  const lo = Math.max(0, anchor - before);
  const hi = Math.min(dated.length - 1, anchor + after);
  return dated.slice(lo, hi + 1).map((d) => d.s);
}

/**
 * Build the flat Mon–Fri day list + per-sprint segments + date→sprint map for a window of sprints.
 * Dates already claimed by an earlier sprint in the list are skipped (first-wins), so an overlapping
 * date appears once and is attributed to one sprint.
 */
export function buildLeaveCalendar(sprints: SprintRef[]): LeaveCalendar {
  const days: CalendarDay[] = [];
  const segments: SprintSegment[] = [];
  const dateToSprintId: Record<string, number> = {};

  for (const s of sprints) {
    const segDays: string[] = [];
    for (const date of sprintWorkingDays(s.startDate, s.endDate)) {
      if (dateToSprintId[date] !== undefined) continue; // first sprint wins on overlap
      dateToSprintId[date] = s.id;
      days.push({ date, sprintId: s.id });
      segDays.push(date);
    }
    segments.push({
      sprintId: s.id,
      name: s.name,
      state: s.state,
      startDate: s.startDate,
      endDate: s.endDate,
      days: segDays,
    });
  }

  return { days, segments, dateToSprintId };
}
