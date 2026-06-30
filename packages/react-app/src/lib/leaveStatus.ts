// leaveStatus.ts (v1.31, ADR-043) — pure summary of who's on leave today + in the coming days.
// Reads the whole leaves store (get_all_leaves / useAllLeaves). No React, no network.

import type { AllLeavesMap } from "./leavesClient";
import type { LeaveType } from "./types";

export interface LeaveOnDay {
  assignee: string;
  type: LeaveType;
}

export interface UpcomingLeave {
  assignee: string;
  date: string; // YYYY-MM-DD
  type: LeaveType;
  daysAway: number; // calendar days from today (≥ 1)
}

export interface LeaveStatus {
  today: LeaveOnDay[];
  upcoming: UpcomingLeave[];
}

/** Whole calendar-day difference toIso − fromIso (both YYYY-MM-DD), UTC, ignoring time. */
function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.UTC(+fromIso.slice(0, 4), +fromIso.slice(5, 7) - 1, +fromIso.slice(8, 10));
  const b = Date.UTC(+toIso.slice(0, 4), +toIso.slice(5, 7) - 1, +toIso.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/**
 * Who is on leave TODAY and who has leave coming up within `horizonDays` (default 7).
 * Flattens every sprint's leaves and dedupes by (assignee, date) — an overlapping date counts once.
 */
export function summarizeLeaveStatus(
  all: AllLeavesMap,
  opts: { today: string; horizonDays?: number }
): LeaveStatus {
  const horizon = opts.horizonDays ?? 7;
  const today = opts.today;

  const seen = new Set<string>();
  const todayList: LeaveOnDay[] = [];
  const upcoming: UpcomingLeave[] = [];

  for (const byAssignee of Object.values(all)) {
    for (const [assignee, dates] of Object.entries(byAssignee)) {
      for (const [date, type] of Object.entries(dates)) {
        const key = `${assignee}::${date}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const away = daysBetween(today, date);
        if (away === 0) todayList.push({ assignee, type });
        else if (away >= 1 && away <= horizon) upcoming.push({ assignee, date, type, daysAway: away });
      }
    }
  }

  todayList.sort((a, b) => a.assignee.localeCompare(b.assignee));
  upcoming.sort((a, b) => a.daysAway - b.daysAway || a.assignee.localeCompare(b.assignee));
  return { today: todayList, upcoming };
}
