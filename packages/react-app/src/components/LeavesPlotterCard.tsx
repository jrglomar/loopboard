// LeavesPlotterCard — Planning-page editable leaves/capacity plotter (v1.8, ADR-019)
//
// Rostered from get_team_members (the curated per-board team roster), NOT
// get_assignable_users. This is essential for planning a near-empty future sprint
// where the team hasn't yet been assigned any tickets and avoids org-wide strangers.
//
// Empty team → a note pointing to "Manage team" in the Planning header.
//
// a11y: card section with heading; delegates grid a11y to LeavesCalendarCard.
// perf: uses existing hooks; capacity derived purely client-side from capacity.ts.

import React from "react";
import { Users, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { LeavesCalendarCard } from "./LeavesCalendarCard";
import { useTeamMembers, useVelocity, useLeaves } from "../hooks/useJira";
import { computeCapacity, computeDevCapacity, sprintWorkingDays, possibleCommittedVelocity } from "../lib/capacity";
import { usePolicy } from "../lib/boards";
import { formatPoints } from "../lib/format";
import type { SprintRef } from "../lib/types";

// ── Props ─────────────────────────────────────────────────────────────────────

export interface LeavesPlotterCardProps {
  boardId?: number;
  sprintId?: number | null;
  sprint?: SprintRef;
  /** @deprecated v1.8: roster comes from useTeamMembers(boardId), not get_assignable_users.
   *  projectKey is kept for backward-compat but is no longer used for the roster. */
  projectKey?: string;
  /**
   * v1.8: increment to force a team refetch after the user saves in TeamManager.
   * The card's useTeamMembers re-runs when this changes.
   */
  teamRevision?: number;
}

// ── Capacity summary panel ────────────────────────────────────────────────────

interface CapacitySummaryProps {
  rosterCount: number;
  workingDayCount: number;
  leavePersonDays: number;
  capacityFactor: number;
  possibleVelocity: number;
  averageCompleted: number;
  hasVelocityBaseline: boolean;
}

function CapacitySummary({
  rosterCount,
  workingDayCount,
  leavePersonDays,
  capacityFactor,
  possibleVelocity,
  averageCompleted,
  hasVelocityBaseline,
}: CapacitySummaryProps) {
  const capacityPct = Math.round(capacityFactor * 100);

  return (
    <div className="mt-4 rounded-lg border border-[hsl(var(--info-border))] bg-[hsl(var(--info-bg))] px-4 py-3 text-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
        Possible committed velocity
        <span className="ml-1 font-normal normal-case text-muted-foreground">
          — heuristic, not a commitment
        </span>
      </p>
      <p className="text-xs text-muted-foreground mb-2">
        <span className="font-medium text-foreground">{rosterCount}</span> people ·{" "}
        <span className="font-medium text-foreground">{workingDayCount}</span> working day
        {workingDayCount !== 1 ? "s" : ""} ·{" "}
        <span className="font-medium text-[hsl(var(--warning-foreground))]">
          {leavePersonDays}
        </span>{" "}
        leave day{leavePersonDays !== 1 ? "s" : ""} →{" "}
        <span className="font-semibold text-[hsl(var(--info))]">{capacityPct}%</span> capacity
      </p>
      {hasVelocityBaseline ? (
        <p className="text-foreground">
          <span className="text-xl font-bold tabular-nums text-[hsl(var(--info))]">
            {formatPoints(possibleVelocity)}
          </span>{" "}
          <span className="text-xs text-muted-foreground">pts</span>
          <span className="ml-2 text-xs text-muted-foreground">
            = {formatPoints(averageCompleted)} avg × {capacityPct}% capacity
          </span>
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold text-[hsl(var(--info))]">{capacityPct}%</span> capacity
          {" "}— no velocity baseline yet (no prior closed sprints).
        </p>
      )}
      <p className="mt-2 text-[0.6875rem] text-muted-foreground leading-snug">
        Possible committed velocity for this sprint — adjusts the average for entered
        leaves, not a commitment.
      </p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function LeavesPlotterCard({
  boardId,
  sprintId,
  sprint,
  // projectKey kept for backward-compat; no longer used for roster (v1.8)
  projectKey: _projectKey,
  teamRevision,
}: LeavesPlotterCardProps) {
  // v1.8 (ADR-019): roster from curated team, NOT get_assignable_users
  // Pass null when boardId is undefined (skip fetch until context is ready)
  const { data: team, loading: usersLoading, error: usersError, run: usersRun } =
    useTeamMembers(boardId ?? null);

  // perf: re-fetch the team roster when TeamManager persists a change
  React.useEffect(() => {
    if (teamRevision !== undefined && teamRevision > 0 && boardId != null) {
      usersRun();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamRevision]);

  // Roster names from the curated team
  const rosterNames: string[] = team?.map((m) => m.displayName) ?? [];

  // Velocity for the capacity calculation (beforeSprintId = sprintId)
  const velocityState = useVelocity(sprintId ?? null, boardId);

  // Leaves data — needed for the capacity calc in this card
  // perf: LeavesCalendarCard also calls useLeaves(sprintId) internally, but
  // React deduplicates identical hook calls within the same render; we read the
  // same data here for the capacity summary without a second network request.
  const { data: leavesData } = useLeaves(sprintId ?? null);

  // perf: capacity derived purely on each render — small inputs, no memoisation needed
  const workingDays = React.useMemo(
    () =>
      sprint !== undefined
        ? sprintWorkingDays(sprint.startDate, sprint.endDate)
        : [],
    [sprint?.startDate, sprint?.endDate]
  );

  // Build leavesByAssignee (dates) from the live typed leavesData (v1.26 — keys are dates).
  const leavesByAssignee: Record<string, string[]> = React.useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const name of rosterNames) {
      map[name] = Object.keys(leavesData?.[name] ?? {});
    }
    return map;
  }, [leavesData, rosterNames]);

  const capacity = React.useMemo(
    () =>
      computeCapacity({
        assignees: rosterNames,
        workingDays,
        leavesByAssignee,
      }),
    [rosterNames, workingDays, leavesByAssignee]
  );

  const avgCompleted = velocityState.data?.averageCompleted ?? 0;
  const hasVelocityBaseline = (velocityState.data?.sprints.length ?? 0) > 0;
  const possibleVelocity = possibleCommittedVelocity(avgCompleted, capacity.capacityFactor);

  // v1.37 (ADR-047): per-developer capacity = required points (N) − working leave days.
  const policy = usePolicy();
  const devCaps = React.useMemo(
    () => computeDevCapacity(policy.requiredPoints, capacity.byAssigneeLeaveDays),
    [policy.requiredPoints, capacity.byAssigneeLeaveDays]
  );

  // ── Card header ─────────────────────────────────────────────────────────────

  const cardHeader = (
    <CardHeader className="pb-2">
      <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
        <Users className="h-4 w-4 text-primary" aria-hidden="true" />
        Leaves / Capacity Plotter
      </h3>
    </CardHeader>
  );

  // ── No sprint dates state ───────────────────────────────────────────────────

  if (!sprint || !sprint.startDate || !sprint.endDate) {
    return (
      <Card className="shadow-sm">
        {cardHeader}
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Set sprint dates to plot leaves and see the capacity estimate.
          </p>
        </CardContent>
      </Card>
    );
  }

  // ── Users loading skeleton ──────────────────────────────────────────────────

  if (usersLoading && !team) {
    return (
      <Card className="shadow-sm">
        {cardHeader}
        {/* a11y: aria-busy while roster loads */}
        <CardContent aria-busy="true" aria-label="Loading team roster">
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-8 w-full rounded" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Bridge-down / error state ───────────────────────────────────────────────

  if (usersError && !team) {
    const isBridgeDown = usersError.code === "BRIDGE_DOWN";
    return (
      <Card className="shadow-sm border-destructive/40">
        {cardHeader}
        <CardContent>
          {/* a11y: role="alert" for announced error */}
          <div role="alert" className="space-y-2">
            <div className="flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
              <p>{isBridgeDown ? "Jira bridge is offline." : usersError.message}</p>
            </div>
            {isBridgeDown && (
              <code className="block font-mono bg-muted border border-border rounded px-2 py-1 text-[0.8125rem] w-fit">
                npm run dev:jira:http
              </code>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={usersRun}
              type="button"
              aria-label="Retry loading team roster"
            >
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Empty team state (v1.8) ─────────────────────────────────────────────────

  if (team !== null && rosterNames.length === 0) {
    return (
      <Card className="shadow-sm">
        {cardHeader}
        <CardContent>
          {/* a11y: describes what action to take */}
          <p className="text-sm text-muted-foreground">
            No team members yet — use{" "}
            <span className="font-medium text-foreground">"Manage team"</span>{" "}
            above to set up your roster.
          </p>
        </CardContent>
      </Card>
    );
  }

  // ── Full render ─────────────────────────────────────────────────────────────

  return (
    <Card className="shadow-sm">
      {cardHeader}
      <CardContent className="space-y-4">
        {/* Editable leaves grid — delegates to LeavesCalendarCard with explicit roster */}
        <LeavesCalendarCard
          sprintId={sprintId ?? null}
          sprint={sprint}
          assignees={rosterNames}
        />

        {/* Capacity summary panel */}
        <CapacitySummary
          rosterCount={rosterNames.length}
          workingDayCount={workingDays.length}
          leavePersonDays={capacity.leavePersonDays}
          capacityFactor={capacity.capacityFactor}
          possibleVelocity={possibleVelocity}
          averageCompleted={avgCompleted}
          hasVelocityBaseline={hasVelocityBaseline}
        />

        {/* v1.37 (ADR-047): per-developer capacity — required N points − working leave days */}
        {devCaps.length > 0 && (
          <div className="rounded-lg border border-border bg-card px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
              Per-developer capacity
              <span className="ml-1 font-normal normal-case text-muted-foreground">
                — required {policy.requiredPoints} pts − working leave days
              </span>
            </p>
            <table className="w-full text-sm" aria-label="Per-developer capacity">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border">
                  <th className="text-left pb-1 font-medium">Developer</th>
                  <th className="text-right pb-1 font-medium">Leave days</th>
                  <th className="text-right pb-1 font-medium">Capacity (pts)</th>
                </tr>
              </thead>
              <tbody>
                {devCaps.map((d) => (
                  <tr key={d.name} className="border-t border-border/40">
                    <td className="py-1 text-foreground">{d.name}</td>
                    <td className="py-1 text-right tabular-nums text-[hsl(var(--warning-foreground))]">{d.leaveDays}</td>
                    <td className="py-1 text-right tabular-nums font-semibold text-foreground">{formatPoints(d.capacity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
