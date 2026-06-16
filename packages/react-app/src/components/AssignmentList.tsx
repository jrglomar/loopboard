// AssignmentList — Assign tickets to developers during sprint planning (v1.8, ADR-019)
//
// Shows the planned sprint's tickets (all buckets from get_active_sprint) with
// an assignee <select> per row. Roster comes from the curated team
// (useTeamMembers), NOT get_assignable_users — fixes the "strangers appear" bug.
//
// Pre-selects the current assignee via issue.assigneeAccountId (v1.8).
// If the current assignee is NOT in the team, shows a disabled "(not on team)"
// option so the assignment isn't silently lost.
//
// Empty team → a note pointing to "Manage team".
//
// a11y: each select has aria-label including the ticket key ("Assignee for VRDB-123").
// perf: optimistic update — no spinner between select change and Jira confirm.

import React, { useState, useCallback } from "react";
import { ClipboardList, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useActiveSprint, useTeamMembers } from "../hooks/useJira";
import { assignIssue } from "../lib/assignClient";
import type { IssueSummary, TeamMember } from "../lib/types";
import type { McpError } from "../lib/mcpClient";
import { formatPoints } from "../lib/format";

// ── Props ─────────────────────────────────────────────────────────────────────

export interface AssignmentListProps {
  boardId?: number;
  sprintId?: number | null;
  projectKey?: string;
  /**
   * v1.8: increment to force a team refetch after the user saves in TeamManager.
   * The card's useTeamMembers re-runs when this changes.
   */
  teamRevision?: number;
}

// ── Per-row state ─────────────────────────────────────────────────────────────

interface RowState {
  /** Current assignee display name (optimistic, may differ from Jira) */
  assigneeDisplayName: string | null;
  /** Current assignee accountId */
  accountId: string | null;
  saving: boolean;
  saved: boolean;
  error: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build the initial row state from the issue's current assignee + team roster.
 * v1.8: prefer assigneeAccountId for pre-selection; fall back to displayName match.
 */
function initialRowState(
  issue: IssueSummary,
  team: TeamMember[]
): RowState {
  // v1.8: primary match via accountId (from assigneeAccountId field)
  let found: TeamMember | undefined = undefined;
  if (issue.assigneeAccountId !== null && issue.assigneeAccountId !== undefined) {
    found = team.find((m) => m.accountId === issue.assigneeAccountId);
  }
  // Fallback: displayName match (for older data without assigneeAccountId)
  if (!found && issue.assignee !== null) {
    found = team.find((m) => m.displayName === issue.assignee);
  }
  return {
    assigneeDisplayName: issue.assignee,
    accountId: found?.accountId ?? issue.assigneeAccountId ?? null,
    saving: false,
    saved: false,
    error: null,
  };
}

// ── Ticket row ────────────────────────────────────────────────────────────────

interface TicketRowProps {
  issue: IssueSummary;
  team: TeamMember[];
  rowState: RowState;
  onAssign: (ticketKey: string, accountId: string | null, displayName: string | null) => void;
}

function TicketRow({ issue, team, rowState, onAssign }: TicketRowProps) {
  // v1.8 (ADR-019): team is keyed by accountId
  const currentInTeam =
    rowState.accountId !== null &&
    team.some((m) => m.accountId === rowState.accountId);

  // v1.9 (ADR-020) — no off-team lock: a current assignee who isn't on the curated
  // team is included as a NORMAL, selectable option (plain name) so the assignment
  // is preserved AND can be re-selected. (Replaces the disabled "(not on team)".)
  const offTeamCurrent: TeamMember | null =
    !currentInTeam && rowState.accountId !== null
      ? {
          accountId: rowState.accountId,
          displayName: rowState.assigneeDisplayName ?? rowState.accountId,
        }
      : null;

  // Selectable roster = curated team (+ the off-team current assignee, if any)
  const selectable: TeamMember[] = offTeamCurrent
    ? [offTeamCurrent, ...team]
    : team;

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value;
    if (val === "") {
      // Unassign
      onAssign(issue.key, null, null);
    } else {
      const member = selectable.find((m) => m.accountId === val);
      if (member) {
        onAssign(issue.key, member.accountId, member.displayName);
      }
    }
  }

  // v1.9: select reflects the current accountId (always present in `selectable`
  // when assigned), else "" (Unassigned).
  const selectValue = rowState.accountId ?? "";

  return (
    <tr className="border-t border-border/40 hover:bg-muted/20 transition-colors">
      {/* Ticket key → Jira link */}
      {/* a11y: descriptive aria-label on the link */}
      <td className="py-2 pr-3">
        <a
          href={issue.url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-xs font-bold text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-ring rounded"
          aria-label={`Open ${issue.key} in Jira`}
        >
          {issue.key}
        </a>
      </td>

      {/* Summary */}
      <td className="py-2 pr-3 max-w-[240px]">
        <p className="text-sm text-foreground truncate" title={issue.summary}>
          {issue.summary}
        </p>
      </td>

      {/* Points */}
      <td className="py-2 pr-4 text-right tabular-nums">
        {issue.storyPoints !== null ? (
          <span className="text-xs text-muted-foreground">
            {formatPoints(issue.storyPoints)}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>

      {/* Assignee select */}
      <td className="py-2 min-w-[160px]">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            {/* a11y: aria-label includes ticket key (ADR-018/019) */}
            <select
              aria-label={`Assignee for ${issue.key}`}
              value={selectValue}
              onChange={handleChange}
              disabled={rowState.saving}
              className="h-8 text-xs px-2 border border-border rounded-md bg-background text-foreground font-[inherit] cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 transition-colors hover:border-ring disabled:opacity-50 disabled:cursor-wait w-full max-w-[180px]"
            >
              <option value="">Unassigned</option>
              {/* v1.9 (ADR-020): the off-team current assignee (if any) is the first
                  entry of `selectable` as a NORMAL selectable option — no lock. */}
              {selectable.map((m) => (
                <option key={m.accountId} value={m.accountId}>
                  {m.displayName}
                </option>
              ))}
            </select>
            {/* Per-row saving / saved indicator */}
            {rowState.saving && (
              <span className="text-[0.6875rem] text-muted-foreground animate-pulse whitespace-nowrap">
                Saving…
              </span>
            )}
            {!rowState.saving && rowState.saved && (
              <span className="text-[0.6875rem] text-[hsl(var(--status-done-text))] whitespace-nowrap">
                Saved
              </span>
            )}
          </div>
          {/* Inline per-row error — non-blocking */}
          {rowState.error && (
            <p
              // a11y: aria-live so screen readers announce the error
              aria-live="polite"
              className="text-[0.6875rem] text-destructive flex items-center gap-1"
            >
              <AlertCircle className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
              {rowState.error}
            </p>
          )}
        </div>
      </td>
    </tr>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function AssignmentList({
  boardId,
  sprintId,
  // projectKey is no longer used for the roster (v1.8); kept for prop compat
  projectKey: _projectKey,
  teamRevision,
}: AssignmentListProps) {
  // Fetch the sprint's tickets (all buckets)
  const sprintState = useActiveSprint(boardId, sprintId ?? undefined);

  // v1.8 (ADR-019): roster from curated team, NOT get_assignable_users
  const { data: team, loading: usersLoading, error: usersError, run: usersRun } =
    useTeamMembers(boardId ?? null);

  // perf: re-fetch team when TeamManager persists a change
  React.useEffect(() => {
    if (teamRevision !== undefined && teamRevision > 0 && boardId != null) {
      usersRun();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamRevision]);

  // Flatten all issue buckets into a single list in reading order
  const allIssues: IssueSummary[] = React.useMemo(() => {
    const d = sprintState.data;
    if (!d) return [];
    return [
      ...d.issuesByStatus.todo,
      ...d.issuesByStatus.inprogress,
      ...d.issuesByStatus.codereview,
      ...d.issuesByStatus.done,
    ];
  }, [sprintState.data]);

  // Per-row state (keyed by ticket key)
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});

  // Sync row states when sprint data or team roster changes
  React.useEffect(() => {
    if (!sprintState.data || !team) return;
    setRowStates((prev) => {
      const next: Record<string, RowState> = {};
      for (const issue of allIssues) {
        // Preserve saving/error/saved state if already tracking this row
        if (prev[issue.key] && !prev[issue.key].saving) {
          next[issue.key] = prev[issue.key];
        } else if (!prev[issue.key]) {
          next[issue.key] = initialRowState(issue, team);
        } else {
          next[issue.key] = prev[issue.key];
        }
      }
      return next;
    });
  }, [allIssues, team, sprintState.data]);

  // Handle assignment change (optimistic update)
  const handleAssign = useCallback(
    async (
      ticketKey: string,
      accountId: string | null,
      displayName: string | null
    ) => {
      // Capture previous state for rollback
      const prev = rowStates[ticketKey];
      if (!prev) return;

      // Optimistic update
      setRowStates((s) => ({
        ...s,
        [ticketKey]: {
          ...s[ticketKey],
          accountId,
          assigneeDisplayName: displayName,
          saving: true,
          saved: false,
          error: null,
        },
      }));

      try {
        await assignIssue(ticketKey, accountId);
        setRowStates((s) => ({
          ...s,
          [ticketKey]: {
            ...s[ticketKey],
            saving: false,
            saved: true,
            error: null,
          },
        }));
        // Clear "saved" indicator after 2 s
        setTimeout(() => {
          setRowStates((s) => ({
            ...s,
            [ticketKey]: { ...s[ticketKey], saved: false },
          }));
        }, 2000);
      } catch (err: unknown) {
        // Revert to previous assignee on error
        const errorMsg =
          err && typeof err === "object" && "message" in err
            ? String((err as McpError).message)
            : "Assignment failed";
        setRowStates((s) => ({
          ...s,
          [ticketKey]: {
            ...prev,
            saving: false,
            saved: false,
            error: errorMsg,
          },
        }));
      }
    },
    [rowStates]
  );

  // ── Card header ─────────────────────────────────────────────────────────────

  const cardHeader = (
    <CardHeader className="pb-2">
      <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
        <ClipboardList className="h-4 w-4 text-primary" aria-hidden="true" />
        Assign Tickets
      </h3>
    </CardHeader>
  );

  // ── Loading skeleton ────────────────────────────────────────────────────────

  if ((sprintState.loading && !sprintState.data) || (usersLoading && !team)) {
    return (
      <Card className="shadow-sm">
        {cardHeader}
        {/* a11y: aria-busy while loading */}
        <CardContent aria-busy="true" aria-label="Loading tickets and team">
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10 w-full rounded" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Bridge-down / error states ──────────────────────────────────────────────

  const sprintError = sprintState.error;
  const effectiveError = sprintError ?? usersError;
  if (effectiveError && !sprintState.data && !team) {
    const isBridgeDown = effectiveError.code === "BRIDGE_DOWN";
    return (
      <Card className="shadow-sm border-destructive/40">
        {cardHeader}
        <CardContent>
          {/* a11y: role="alert" for announced error */}
          <div role="alert" className="space-y-2">
            <div className="flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
              <p>{isBridgeDown ? "Jira bridge is offline." : effectiveError.message}</p>
            </div>
            {isBridgeDown && (
              <code className="block font-mono bg-muted border border-border rounded px-2 py-1 text-[0.8125rem] w-fit">
                npm run dev:jira:http
              </code>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={sprintError ? sprintState.run : usersRun}
              type="button"
              aria-label="Retry loading tickets"
            >
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Empty team state (v1.8) ─────────────────────────────────────────────────

  if (team !== null && team.length === 0) {
    return (
      <Card className="shadow-sm">
        {cardHeader}
        <CardContent>
          {/* a11y: describes what action to take */}
          <p className="text-sm text-muted-foreground">
            No team members yet — use{" "}
            <span className="font-medium text-foreground">"Manage team"</span>{" "}
            above to set up your roster before assigning tickets.
          </p>
        </CardContent>
      </Card>
    );
  }

  // ── Empty tickets state (future sprint with no issues yet) ──────────────────

  if (sprintState.data && allIssues.length === 0) {
    return (
      <Card className="shadow-sm">
        {cardHeader}
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Add tickets above, then assign them here.
          </p>
        </CardContent>
      </Card>
    );
  }

  // ── Full assignment table ───────────────────────────────────────────────────

  const resolvedTeam = team ?? [];

  return (
    <Card className="shadow-sm">
      {cardHeader}
      <CardContent>
        <div className="overflow-x-auto">
          {/* a11y: data table with caption */}
          <table
            className="w-full text-sm"
            aria-label="Sprint tickets — assign a developer to each ticket"
          >
            <thead>
              <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground border-b border-border">
                <th className="text-left pb-2 pr-3">Key</th>
                <th className="text-left pb-2 pr-3">Summary</th>
                <th className="text-right pb-2 pr-4">Pts</th>
                <th className="text-left pb-2">Assignee</th>
              </tr>
            </thead>
            <tbody>
              {allIssues.map((issue) => (
                <TicketRow
                  key={issue.key}
                  issue={issue}
                  team={resolvedTeam}
                  rowState={
                    rowStates[issue.key] ?? initialRowState(issue, resolvedTeam)
                  }
                  onAssign={(key, accountId, displayName) =>
                    void handleAssign(key, accountId, displayName)
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
