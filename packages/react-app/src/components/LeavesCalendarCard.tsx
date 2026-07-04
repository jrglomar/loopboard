// LeavesCalendarCard — per-sprint working-day leaves grid (ADR-016, v1.5)
//
// a11y: the grid is a semantic <table> with scope headers; each toggle
//       button has aria-pressed and an accessible name "<name> off on <date>".
// perf: the grid is small (≤ ~10 people × ≤ ~15 days); a plain table is fine —
//       no virtualisation or canvas needed. No charting/date-picker library.

import React from "react";
import { Calendar, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useLeaves } from "../hooks/useJira";
import { sprintWorkingDays } from "../lib/capacity";
import type { SprintRef, LeaveType, AssigneeLeaves } from "../lib/types";
import type { LeaveEntry } from "../lib/leavesClient";

// ── Leave-type visuals (v1.26, ADR-038) ───────────────────────────────────────
// Dark-mode-safe via role tokens: VL=info, EL=destructive, Holiday=success, Offset=accent.
const LEAVE_STYLE: Record<LeaveType, string> = {
  VL: "bg-[hsl(var(--info-bg))] text-[hsl(var(--info))] border-[hsl(var(--info-border))]",
  EL: "bg-[hsl(var(--error-bg))] text-[hsl(var(--error))] border-[hsl(var(--error-border))]",
  Holiday: "bg-[hsl(var(--success-bg))] text-[hsl(var(--success))] border-[hsl(var(--success-border))]",
  Offset: "bg-[hsl(var(--accent)/0.12)] text-[hsl(var(--accent))] border-[hsl(var(--accent)/0.4)]",
};
const LEAVE_ABBR: Record<LeaveType, string> = { VL: "VL", EL: "EL", Holiday: "HO", Offset: "OF" };

/** Build set_leaves entries from an assignee's date→type map. */
function toEntries(map: AssigneeLeaves): LeaveEntry[] {
  return Object.entries(map).map(([date, type]) => ({ date, type }));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns 2-letter uppercase initials from a display name */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Format YYYY-MM-DD → e.g. "Mo 3" (short day + date number) */
function formatDayHeader(iso: string): string {
  // Parse as local date to match the display expectation
  const [, , dd] = iso.split("-");
  const date = new Date(`${iso}T12:00:00Z`);
  const dayName = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][date.getUTCDay()];
  return `${dayName} ${parseInt(dd, 10)}`;
}

/** Format date for short display in aria labels: "Mon Jun 3" */
function formatFullDate(iso: string): string {
  const date = new Date(`${iso}T12:00:00Z`);
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// ── Saving indicator ──────────────────────────────────────────────────────────

function SavingIndicator({ saving }: { saving: boolean }) {
  if (!saving) return null;
  return (
    <span className="text-[0.6875rem] text-muted-foreground animate-pulse ml-2">
      Saving…
    </span>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface LeavesCalendarCardProps {
  /**
   * The selected sprint ID (used to key get_leaves / set_leaves).
   * Pass null when no sprint is selected yet.
   */
  sprintId: number | null;
  /** The full sprint descriptor — used for startDate/endDate working-day range */
  sprint: SprintRef;
  /**
   * Assignee names from SprintReport.byAssignee.
   * These become the row labels. May be empty for future sprints with no issues yet.
   * Ignored when `assignees` is provided.
   */
  byAssignee?: Array<{ name: string }>;
  /**
   * Explicit roster of assignee display names (used by LeavesPlotterCard on
   * Planning, where the team comes from get_assignable_users rather than sprint
   * issues). When provided, takes precedence over byAssignee.
   */
  assignees?: string[];
  /**
   * Optional callback: parent passes the computed leave-days-per-assignee map up
   * so the ByAssigneeTable can show the Leaves column without a second fetch.
   */
  onLeavesChange?: (leaveDays: Record<string, number>) => void;
  /**
   * When true, all day-toggle buttons are rendered as static cells — no toggling,
   * no setLeaves calls. Used by Reports (read-only leaves view, ADR-018 v1.7).
   */
  readOnly?: boolean;
  /**
   * v1.26 (ADR-038): the leave type painted on click. When provided (Leaves page), clicking a
   * cell sets it to this type (or clears it if already that type). When omitted, clicking toggles
   * a day off as the default "VL" (legacy Planning/Reports behavior).
   */
  paintType?: LeaveType;
}

// ── Main component ────────────────────────────────────────────────────────────

export function LeavesCalendarCard({
  sprintId,
  sprint,
  byAssignee,
  assignees: assigneesProp,
  onLeavesChange,
  readOnly = false,
  paintType,
}: LeavesCalendarCardProps) {
  // Resolve the roster: explicit assignees prop wins over byAssignee
  // perf: derived inline — no extra state
  const rosterNames: string[] = React.useMemo(() => {
    if (assigneesProp !== undefined) return assigneesProp;
    if (byAssignee !== undefined) return byAssignee.map((a) => a.name);
    return [];
  }, [assigneesProp, byAssignee]);

  const { data: leaves, loading, error, run, save } = useLeaves(sprintId);
  const [savingCell, setSavingCell] = React.useState<string | null>(null);
  const [justSaved, setJustSaved] = React.useState<string | null>(null);

  // Derive working days for the sprint
  const workingDays = React.useMemo(
    () => sprintWorkingDays(sprint.startDate, sprint.endDate),
    [sprint.startDate, sprint.endDate]
  );

  // Derive per-assignee leave-day counts and propagate upward
  React.useEffect(() => {
    if (!onLeavesChange) return;
    const map: Record<string, number> = {};
    const workingSet = new Set(workingDays);
    for (const name of rosterNames) {
      const dateMap = leaves?.[name] ?? {};
      map[name] = Object.keys(dateMap).filter((d) => workingSet.has(d.slice(0, 10))).length;
    }
    onLeavesChange(map);
  }, [leaves, rosterNames, workingDays, onLeavesChange]);

  // ── Toggle a single cell ────────────────────────────────────────────────────

  async function handleToggle(assigneeName: string, date: string) {
    const cellKey = `${assigneeName}::${date}`;
    const current: AssigneeLeaves = leaves?.[assigneeName] ?? {};
    const type = paintType ?? "VL";
    const next: AssigneeLeaves = { ...current };
    if (next[date] === type) delete next[date]; // clicking the same type clears it
    else next[date] = type; // set or overwrite with the painted type

    setSavingCell(cellKey);
    try {
      await save(assigneeName, toEntries(next));
      setJustSaved(cellKey);
      setTimeout(() => setJustSaved((prev) => (prev === cellKey ? null : prev)), 1500);
    } catch {
      // Error surfaces via the useLeaves `error` state on re-render
    } finally {
      setSavingCell(null);
    }
  }

  // ── Header ─────────────────────────────────────────────────────────────────

  const cardHeader = (
    <CardHeader className="pb-2">
      <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
        <Calendar className="h-4 w-4 text-primary" aria-hidden="true" />
        Leaves / Team Calendar
        {loading && (
          <span className="text-[0.6875rem] text-muted-foreground font-normal animate-pulse ml-1">
            Loading…
          </span>
        )}
        {savingCell && <SavingIndicator saving={true} />}
        {!savingCell && justSaved && (
          <span className="text-[0.6875rem] text-[hsl(var(--status-done-text))] ml-2">
            Saved
          </span>
        )}
      </h3>
    </CardHeader>
  );

  // ── No dates state (future sprint without dates) ────────────────────────────

  if (!sprint.startDate || !sprint.endDate || workingDays.length === 0) {
    return (
      <Card className="shadow-sm h-full">
        {cardHeader}
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Sprint has no dates — leaves need a date range. Set start and end dates on this
            sprint in Jira to enable the calendar.
          </p>
        </CardContent>
      </Card>
    );
  }

  // ── No assignees state ──────────────────────────────────────────────────────

  if (rosterNames.length === 0) {
    return (
      <Card className="shadow-sm h-full">
        {cardHeader}
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No assignees on this sprint yet. Assignees appear here once issues are added.
          </p>
        </CardContent>
      </Card>
    );
  }

  // ── Bridge-down / error state ───────────────────────────────────────────────

  if (error && !loading && !leaves) {
    const isBridgeDown = error.code === "BRIDGE_DOWN";
    return (
      <Card className="shadow-sm h-full border-destructive/40">
        {cardHeader}
        <CardContent>
          {/* a11y: role="alert" for announced error */}
          <div role="alert" className="space-y-2">
            <div className="flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
              <p>{isBridgeDown ? "Jira bridge is offline." : error.message}</p>
            </div>
            {isBridgeDown && (
              <code className="block font-mono bg-muted border border-border rounded px-2 py-1 text-[0.8125rem] w-fit">
                npm run dev:jira:http
              </code>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={run}
              type="button"
              aria-label="Retry loading leaves"
            >
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Loading skeleton ────────────────────────────────────────────────────────

  if (loading && !leaves) {
    return (
      <Card className="shadow-sm h-full">
        {cardHeader}
        {/* a11y: aria-busy while loading */}
        <CardContent aria-busy="true" aria-label="Loading leaves calendar">
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-8 w-full rounded" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Grid ────────────────────────────────────────────────────────────────────

  return (
    <Card className="shadow-sm h-full">
      {cardHeader}
      <CardContent>
        {/* perf: plain table — grid is small (≤10 people × ≤15 days) */}
        <div className="overflow-x-auto">
          {/* a11y: data table with proper scope on headers */}
          <table
            className="text-xs border-collapse w-full"
            aria-label={
              readOnly
                ? "Team leaves calendar — read only"
                : "Team leaves calendar — click a cell to toggle a day off"
            }
          >
            <thead>
              <tr>
                {/* Corner cell */}
                <th
                  scope="col"
                  className="text-left pb-2 pr-4 font-medium text-muted-foreground uppercase tracking-wide min-w-[170px]"
                >
                  Assignee
                </th>
                {workingDays.map((day) => (
                  <th
                    key={day}
                    scope="col"
                    className="pb-2 px-1 font-medium text-center text-muted-foreground uppercase tracking-wide min-w-[36px]"
                    title={day}
                  >
                    {formatDayHeader(day)}
                  </th>
                ))}
                <th
                  scope="col"
                  className="pb-2 pl-3 font-medium text-right text-muted-foreground uppercase tracking-wide min-w-[48px]"
                >
                  Days off
                </th>
              </tr>
            </thead>
            <tbody>
              {rosterNames.map((name) => {
                const assigneeMap: AssigneeLeaves = leaves?.[name] ?? {};
                const workingSet = new Set(workingDays);
                const leaveDaysCount = Object.keys(assigneeMap).filter((d) =>
                  workingSet.has(d.slice(0, 10))
                ).length;

                return (
                  <tr
                    key={name}
                    className="border-t border-border/40 hover:bg-muted/20 transition-colors"
                  >
                    {/* Assignee name with initials avatar */}
                    {/* a11y: th scope="row" for the assignee label */}
                    <th
                      scope="row"
                      className="py-1.5 pr-3 text-left font-medium text-foreground"
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary font-semibold text-[0.625rem] flex-shrink-0"
                          aria-hidden="true"
                        >
                          {initials(name)}
                        </span>
                        <span className="truncate max-w-[200px] whitespace-nowrap" title={name}>
                          {name}
                        </span>
                      </div>
                    </th>

                    {/* Day cells — typed (v1.26): colored by leave type, labeled with its abbreviation */}
                    {workingDays.map((day) => {
                      const cellType = assigneeMap[day]; // LeaveType | undefined
                      const isOff = !!cellType;
                      const cellKey = `${name}::${day}`;
                      const isSaving = savingCell === cellKey;
                      const wasSaved = justSaved === cellKey;
                      const filled = cellType ? LEAVE_STYLE[cellType] : "bg-muted border-border";
                      const label = cellType ? LEAVE_ABBR[cellType] : "";

                      return (
                        <td key={day} className="py-1.5 px-1 text-center">
                          {readOnly ? (
                            <span
                              className={["inline-flex items-center justify-center w-7 h-7 rounded border text-[0.625rem] font-semibold", filled].join(" ")}
                              title={cellType ? `${name}: ${cellType} on ${day}` : undefined}
                              aria-label={cellType ? `${name} ${cellType} on ${formatFullDate(day)}` : undefined}
                            >
                              {label}
                            </span>
                          ) : (
                            <button
                              type="button"
                              aria-pressed={isOff}
                              aria-label={`${name} ${cellType ?? "working"} on ${formatFullDate(day)}`}
                              onClick={() => void handleToggle(name, day)}
                              disabled={isSaving}
                              className={[
                                "w-7 h-7 rounded border transition-all text-[0.625rem] font-semibold hover:opacity-80",
                                "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
                                "disabled:opacity-50 disabled:cursor-wait",
                                filled,
                                wasSaved ? "ring-1 ring-[hsl(var(--status-done))]" : "",
                              ].filter(Boolean).join(" ")}
                              title={cellType ? `${name}: ${cellType} on ${day}` : `Mark ${name} off on ${day}`}
                            >
                              {label}
                            </button>
                          )}
                        </td>
                      );
                    })}

                    {/* Leave days total for this assignee */}
                    <td className="py-1.5 pl-3 text-right tabular-nums text-muted-foreground">
                      {leaveDaysCount > 0 ? (
                        <span className="font-semibold text-[hsl(var(--warning-foreground))]">
                          {leaveDaysCount}
                        </span>
                      ) : (
                        <span>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Inline error overlay while grid is displayed (e.g. after a save fails) */}
        {error && leaves && (
          <div
            // a11y: aria-live for announced error updates
            aria-live="polite"
            className="mt-3 text-xs text-destructive flex items-center gap-1.5"
          >
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
            Save failed: {error.message}
            {error.code === "BRIDGE_DOWN" && (
              <code className="font-mono bg-muted rounded px-1 ml-1">
                npm run dev:jira:http
              </code>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
