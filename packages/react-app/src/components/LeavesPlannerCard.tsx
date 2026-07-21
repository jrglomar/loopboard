// LeavesPlannerCard (v1.29, ADR-041) — forward, multi-sprint leave planner.
//
// A person-row × working-day-column matrix spanning a WINDOW of sprints (recent + active + next few),
// grouped by sprint with labelled dividers. Weekends never render (sprintWorkingDays = Mon–Fri).
// Clicking a cell paints the selected leave type and saves via set_leaves for THAT day's sprint —
// so each plotted day auto-attributes to the sprint whose date range contains it.

import React from "react";
import { CalendarRange, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { buildLeaveCalendar } from "../lib/leavePlanner";
import type { AllLeavesMap, LeaveEntry } from "../lib/leavesClient";
import type { SprintRef, LeaveType, AssigneeLeaves } from "../lib/types";

const LEAVE_STYLE: Record<LeaveType, string> = {
  VL: "bg-[hsl(var(--info-bg))] text-[hsl(var(--info))] border-[hsl(var(--info-border))]",
  EL: "bg-[hsl(var(--error-bg))] text-[hsl(var(--error))] border-[hsl(var(--error-border))]",
  Holiday: "bg-[hsl(var(--success-bg))] text-[hsl(var(--success))] border-[hsl(var(--success-border))]",
  Offset: "bg-[hsl(var(--accent)/0.12)] text-[hsl(var(--accent))] border-[hsl(var(--accent)/0.4)]",
};
const LEAVE_ABBR: Record<LeaveType, string> = { VL: "VL", EL: "EL", Holiday: "HO", Offset: "OF" };

const SEGMENT_STYLE: Record<SprintRef["state"], string> = {
  closed: "bg-muted text-muted-foreground",
  active: "bg-primary/10 text-primary",
  future: "bg-[hsl(var(--info-bg))] text-[hsl(var(--info))]",
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** { weekday: "TH", monthDay: "Jul 30" } — stacked weekday + month/day, from YYYY-MM-DD. */
function dayHeader(iso: string): { weekday: string; monthDay: string } {
  const date = new Date(`${iso}T12:00:00Z`);
  const weekday = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"][date.getUTCDay()];
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getUTCMonth()];
  return { weekday, monthDay: `${month} ${parseInt(iso.slice(8, 10), 10)}` };
}

function toEntries(map: AssigneeLeaves): LeaveEntry[] {
  return Object.entries(map).map(([date, type]) => ({ date, type }));
}

export interface LeavesPlannerCardProps {
  /** The window of sprints to render (already selected by selectCalendarSprints). */
  sprints: SprintRef[];
  /** Assignee display names → one row each. */
  roster: string[];
  /** The whole leaves store, keyed by sprint id (string). */
  leavesBySprint: AllLeavesMap;
  /** The leave type painted on click. */
  paintType: LeaveType;
  /** Persist an assignee's full entries for one sprint (the day's sprint). */
  onPlot: (sprintId: number, assignee: string, entries: LeaveEntry[]) => Promise<void> | void;
  loading?: boolean;
}

export function LeavesPlannerCard({
  sprints,
  roster,
  leavesBySprint,
  paintType,
  onPlot,
  loading = false,
}: LeavesPlannerCardProps) {
  const calendar = React.useMemo(() => buildLeaveCalendar(sprints), [sprints]);
  const nonEmptySegments = React.useMemo(() => calendar.segments.filter((s) => s.days.length > 0), [calendar.segments]);
  const [savingCell, setSavingCell] = React.useState<string | null>(null);

  const header = (
    <CardHeader className="px-4 pt-3 pb-2">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
        <CalendarRange className="h-4 w-4 text-primary" aria-hidden="true" />
        Leave planner
        {loading && <span className="text-[0.6875rem] text-muted-foreground font-normal animate-pulse ml-1">Loading…</span>}
        <span className="ml-auto text-[0.6875rem] font-normal text-muted-foreground">Mon–Fri only</span>
      </h3>
    </CardHeader>
  );

  if (calendar.days.length === 0) {
    return (
      <Card className="shadow-sm">
        {header}
        <CardContent className="px-4 pb-4">
          <p className="text-sm text-muted-foreground">
            No sprints with start/end dates to plan against. Set dates on upcoming sprints in Jira.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (roster.length === 0) {
    return (
      <Card className="shadow-sm">
        {header}
        <CardContent className="px-4 pb-4">
          <p className="text-sm text-muted-foreground">
            No team members yet — add them in Planning → Manage team.
          </p>
        </CardContent>
      </Card>
    );
  }

  async function handleToggle(sprintId: number, assignee: string, date: string) {
    const cellKey = `${assignee}::${date}`;
    const current: AssigneeLeaves = leavesBySprint[String(sprintId)]?.[assignee] ?? {};
    const next: AssigneeLeaves = { ...current };
    if (next[date] === paintType) delete next[date];
    else next[date] = paintType;
    setSavingCell(cellKey);
    try {
      await onPlot(sprintId, assignee, toEntries(next));
    } catch {
      /* surfaced by the page's error state */
    } finally {
      setSavingCell(null);
    }
  }

  return (
    // w-fit: hug the day grid — the page background, not white card, fills the rest (v1.39)
    <Card className="shadow-sm">
      {header}
      <CardContent className="px-4 pb-3 pt-0 overflow-x-auto">
        <table className="text-xs border-collapse w-full " aria-label="Forward leave planner — click a cell to plot the selected type">
          <thead>
            {/* Sprint group header row */}
            <tr>
              <th className="sticky left-0 bg-card z-10 text-left pb-2 pr-4 border-r border-border min-w-[170px]" aria-hidden="true" />
              {nonEmptySegments.map((seg, si) => (
                <th
                  key={seg.sprintId}
                  colSpan={seg.days.length}
                  className={cn("pb-2 px-1 text-center font-medium", si > 0 && "border-l border-border")}
                >
                  <span
                    className={cn("inline-block rounded px-2 py-0.5 text-[0.625rem] font-semibold truncate max-w-[200px]", SEGMENT_STYLE[seg.state])}
                    title={`${seg.name} (${seg.state})`}
                  >
                    {seg.name}
                  </span>
                </th>
              ))}
            </tr>
            {/* Day-of header row */}
            <tr className="text-muted-foreground">
              <th scope="col" className="sticky left-0 bg-card z-10 text-left pb-2 pr-3 border-r border-border font-medium uppercase tracking-wide">
                Assignee
              </th>
              {calendar.days.map((d, i) => {
                const firstOfSprint = i > 0 && calendar.days[i - 1]!.sprintId !== d.sprintId;
                const h = dayHeader(d.date);
                return (
                  <th
                    key={d.date}
                    scope="col"
                    className={cn("pb-2 px-1 font-medium text-center min-w-[46px]", firstOfSprint && "border-l border-border")}
                    title={d.date}
                  >
                    <span className="block text-[0.625rem] font-semibold uppercase text-foreground/70 leading-tight">{h.weekday}</span>
                    <span className="block text-[0.6875rem] leading-tight">{h.monthDay}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {roster.map((name) => (
              <tr key={name} className="group border-t border-border/40 hover:bg-primary/5 transition-colors">
                <th scope="row" className="sticky left-0 bg-card group-hover:bg-primary/10 z-10 py-1.5 pr-3 border-r border-border text-left font-medium text-foreground transition-colors">
                  <div className="flex items-center gap-1.5">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary font-semibold text-[0.625rem] flex-shrink-0" aria-hidden="true">
                      {initials(name)}
                    </span>
                    <span className="truncate max-w-[200px] whitespace-nowrap" title={name}>{name}</span>
                  </div>
                </th>
                {calendar.days.map((d, i) => {
                  const cellType = leavesBySprint[String(d.sprintId)]?.[name]?.[d.date];
                  const isOff = !!cellType;
                  const cellKey = `${name}::${d.date}`;
                  const firstOfSprint = i > 0 && calendar.days[i - 1]!.sprintId !== d.sprintId;
                  const filled = cellType ? LEAVE_STYLE[cellType] : "bg-muted border-border";
                  return (
                    <td
                      key={d.date}
                      className={cn("py-1.5 px-1 text-center", firstOfSprint && "border-l border-border")}
                    >
                      <button
                        type="button"
                        aria-pressed={isOff}
                        aria-label={`${name} ${cellType ?? "working"} on ${d.date}`}
                        onClick={() => void handleToggle(d.sprintId, name, d.date)}
                        disabled={savingCell === cellKey}
                        className={cn(
                          "w-7 h-7 rounded border transition-all text-[0.625rem] font-semibold hover:opacity-80",
                          "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 disabled:opacity-50 disabled:cursor-wait",
                          filled,
                        )}
                        title={cellType ? `${name}: ${cellType} on ${d.date}` : `Plot ${paintType} for ${name} on ${d.date}`}
                      >
                        {cellType ? LEAVE_ABBR[cellType] : ""}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[0.6875rem] text-muted-foreground flex items-center gap-1">
          <AlertCircle className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
          Each plotted day is saved to the sprint that contains it. Weekends are not shown.
        </p>
      </CardContent>
    </Card>
  );
}
