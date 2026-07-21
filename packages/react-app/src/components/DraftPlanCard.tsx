// DraftPlanCard — Draft Capacity Plan (v1.68, ADR-079; CONTRACTS.md §4.30)
//
// PO-board-only Planning card: the PO drags PO-sprint ticket chips onto DEV-board
// team-member tiles to build a DRAFT plan, and sees each developer's drafted
// points vs capacity. It NEVER calls assign_issue — real assignment stays on the
// Dev board's Planning/Linking flow (assign_issue, §4.15). The draft is persisted
// server-side (get_draft_plan / set_draft_plan) so it's a shared team artifact,
// not per-browser localStorage.
//
// Dev roster + capacity are read straight from the Dev board (useTeamMembers,
// useSprintList, useLeaves) — the same one-roster-per-board model as ADR-019,
// with an in-card TeamManager ("Dev team") so the PO never has to leave this page
// to fix the Dev roster.
//
// Drag-and-drop: native HTML5 DnD (ADR-079 — no dnd-kit/react-dnd dependency).
// Every draggable chip also carries a native "Draft to…" <select> — the
// keyboard/screen-reader path (ADR-009: native controls only).
//
// a11y: card section with heading; every interactive control has an aria-label;
// mutation errors are aria-live.
// perf: rollups (totals/unplanned/stale) are pure and derived per render from
// small inputs — no memoisation beyond React.useMemo guards against churn.

import React from "react";
import { Target, AlertCircle, X } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { TeamManager } from "./TeamManager";
import {
  useActiveSprint,
  useTeamMembers,
  useSprintList,
  useLeaves,
  useDraftPlan,
} from "../hooks/useJira";
import { pairDevSprint } from "../lib/sprintPairing";
import { draftTotalsByAccount, unplannedIssues, staleDraftEntries, type StaleDraftEntry } from "../lib/draftPlan";
import { computeCapacity, computeDevCapacity, sprintWorkingDays } from "../lib/capacity";
import { usePolicy } from "../lib/boards";
import { formatPoints } from "../lib/format";
import type { IssueSummary, SprintRef, TeamMember, DraftAssignment } from "../lib/types";

const selectCls =
  "h-8 text-xs px-2 border border-border rounded-md bg-background text-foreground font-[inherit] cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 transition-colors hover:border-ring disabled:opacity-50 disabled:cursor-wait";

// ── Props ─────────────────────────────────────────────────────────────────────

export interface DraftPlanCardProps {
  poBoardId?: number;
  sprintId?: number | null;
  sprint?: SprintRef;
  devBoardId?: number;
  /** v1.68: increment to force a Dev-roster refetch after TeamManager saves. */
  teamRevision?: number;
  onTeamChange?: () => void;
}

// ── Unplanned ticket chip ─────────────────────────────────────────────────────

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

interface UnplannedChipProps {
  issue: IssueSummary;
  roster: TeamMember[];
  onDraftTo: (issueKey: string, member: TeamMember) => void;
}

function UnplannedChip({ issue, roster, onDraftTo }: UnplannedChipProps) {
  return (
    <li
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/plain", issue.key)}
      title={issue.summary}
      className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5 text-xs cursor-grab active:cursor-grabbing"
    >
      <span className="font-mono font-bold text-foreground flex-shrink-0">{issue.key}</span>
      <span className="flex-1 min-w-0 truncate text-muted-foreground">{truncate(issue.summary, 40)}</span>
      <span className="tabular-nums font-semibold text-foreground flex-shrink-0">
        {formatPoints(issue.storyPoints ?? 0)}
      </span>
      <select
        aria-label={`Draft ${issue.key} to a developer`}
        value=""
        onChange={(e) => {
          const member = roster.find((m) => m.accountId === e.target.value);
          if (member) onDraftTo(issue.key, member);
        }}
        className={selectCls}
      >
        <option value="">Draft to…</option>
        {roster.map((m) => (
          <option key={m.accountId} value={m.accountId}>
            {m.displayName}
          </option>
        ))}
      </select>
    </li>
  );
}

// ── Developer tile ────────────────────────────────────────────────────────────

interface DevTileProps {
  member: TeamMember;
  capacity: number | null;
  drafted: { points: number; count: number; issues: IssueSummary[] };
  roster: TeamMember[];
  onDraftTo: (issueKey: string, member: TeamMember) => void;
  onRemove: (issueKey: string) => void;
}

function DevTile({ member, capacity, drafted, roster, onDraftTo, onRemove }: DevTileProps) {
  const initials = member.displayName
    .split(" ")
    .map((w) => w[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");

  let delta: React.ReactNode = null;
  if (capacity !== null) {
    const diff = capacity - drafted.points;
    if (diff > 0) {
      delta = (
        <span className="text-[0.6875rem] font-medium text-muted-foreground px-1.5 py-0.5 rounded-full bg-muted whitespace-nowrap">
          {formatPoints(diff)} free
        </span>
      );
    } else if (diff === 0) {
      delta = (
        <span className="text-[0.6875rem] font-semibold px-1.5 py-0.5 rounded-full bg-success-bg text-success border border-success-border whitespace-nowrap">
          At capacity
        </span>
      );
    } else {
      delta = (
        <span className="text-[0.6875rem] font-semibold px-1.5 py-0.5 rounded-full bg-warning-bg text-warning-foreground border border-warning-border whitespace-nowrap">
          +{formatPoints(-diff)} over
        </span>
      );
    }
  }

  return (
    <li
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const key = e.dataTransfer.getData("text/plain");
        if (key) onDraftTo(key, member);
      }}
      className="rounded-lg border border-border bg-card p-3 space-y-2"
    >
      <div className="flex items-center gap-2">
        {/* a11y: avatar is decorative */}
        <span
          aria-hidden="true"
          className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[0.625rem] font-bold text-primary flex-shrink-0"
        >
          {initials}
        </span>
        <span className="text-sm font-medium text-foreground flex-1 min-w-0 truncate">{member.displayName}</span>
        {delta}
      </div>
      <p className="text-xs text-muted-foreground">
        <span className="font-semibold text-foreground tabular-nums">{formatPoints(drafted.points)}</span>{" "}
        pts drafted ({drafted.count}) ·{" "}
        {capacity !== null ? (
          <>
            capacity{" "}
            <span className="font-semibold text-foreground tabular-nums">{formatPoints(capacity)}</span> pts
          </>
        ) : (
          "capacity —"
        )}
      </p>
      {drafted.issues.length > 0 && (
        <ul role="list" className="space-y-1">
          {drafted.issues.map((issue) => (
            <li
              key={issue.key}
              title={issue.summary}
              className="flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-2 py-1 text-xs"
            >
              <span className="font-mono font-bold text-foreground flex-shrink-0">{issue.key}</span>
              <span className="flex-1 min-w-0 truncate text-muted-foreground">{truncate(issue.summary, 40)}</span>
              <span className="tabular-nums font-semibold text-foreground flex-shrink-0">
                {formatPoints(issue.storyPoints ?? 0)}
              </span>
              <select
                aria-label={`Draft ${issue.key} to a developer`}
                value={member.accountId}
                onChange={(e) => {
                  const target = roster.find((m) => m.accountId === e.target.value);
                  if (target) onDraftTo(issue.key, target);
                }}
                className={selectCls}
              >
                {roster.map((m) => (
                  <option key={m.accountId} value={m.accountId}>
                    {m.displayName}
                  </option>
                ))}
              </select>
              <button
                type="button"
                aria-label={`Remove ${issue.key} from ${member.displayName}`}
                onClick={() => onRemove(issue.key)}
                className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 focus:outline-none focus:ring-2 focus:ring-ring transition-colors flex-shrink-0"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function DraftPlanCard({
  poBoardId,
  sprintId,
  sprint,
  devBoardId,
  teamRevision,
  onTeamChange,
}: DraftPlanCardProps) {
  const devSprintSelectId = React.useId();

  const poSprintState = useActiveSprint(poBoardId, sprintId);

  const { data: devTeam, loading: devTeamLoading, error: devTeamError, run: devTeamRun } =
    useTeamMembers(devBoardId ?? null);

  // perf: re-fetch the Dev roster when the in-card (or Planning-header) TeamManager persists a change.
  React.useEffect(() => {
    if (teamRevision !== undefined && teamRevision > 0 && devBoardId != null) {
      devTeamRun();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamRevision]);

  const devSprintListState = useSprintList("all", devBoardId);
  const devActive: SprintRef[] = devSprintListState.data?.active ?? [];
  const devFuture: SprintRef[] = devSprintListState.data?.future ?? [];

  const draftState = useDraftPlan(sprintId ?? null);

  // PO sprint tickets — flattened buckets (same convention as AssignmentList).
  const poIssues: IssueSummary[] = React.useMemo(() => {
    const d = poSprintState.data;
    if (!d) return [];
    return [
      ...d.issuesByStatus.todo,
      ...d.issuesByStatus.inprogress,
      ...d.issuesByStatus.codereview,
      ...d.issuesByStatus.done,
    ];
  }, [poSprintState.data]);

  const devRoster: TeamMember[] = devTeam ?? [];
  const devRosterNames = React.useMemo(() => devRoster.map((m) => m.displayName), [devRoster]);

  // ── Dev sprint pairing (default) + effective selection ──────────────────────

  const pairedDefault = React.useMemo(
    () => pairDevSprint(sprint, devActive, devFuture),
    [sprint, devActive, devFuture]
  );

  const effectiveDevSprintId: number | null = draftState.data?.devSprintId ?? pairedDefault?.id ?? null;

  const effectiveDevSprint: SprintRef | undefined = React.useMemo(
    () => [...devFuture, ...devActive].find((s) => s.id === effectiveDevSprintId),
    [devFuture, devActive, effectiveDevSprintId]
  );

  const capacityKnown = !!effectiveDevSprint?.startDate && !!effectiveDevSprint?.endDate;

  // ── Capacity (verbatim ADR-047 model, over the PAIRED Dev sprint) ───────────

  const leavesState = useLeaves(effectiveDevSprintId);

  const workingDays = React.useMemo(
    () => sprintWorkingDays(effectiveDevSprint?.startDate, effectiveDevSprint?.endDate),
    [effectiveDevSprint?.startDate, effectiveDevSprint?.endDate]
  );

  const leavesByAssignee: Record<string, string[]> = React.useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const name of devRosterNames) {
      map[name] = Object.keys(leavesState.data?.[name] ?? {});
    }
    return map;
  }, [leavesState.data, devRosterNames]);

  const capacity = React.useMemo(
    () => computeCapacity({ assignees: devRosterNames, workingDays, leavesByAssignee }),
    [devRosterNames, workingDays, leavesByAssignee]
  );

  const policy = usePolicy();
  const devCaps = React.useMemo(
    () => computeDevCapacity(policy.requiredPoints, capacity.byAssigneeLeaveDays),
    [policy.requiredPoints, capacity.byAssigneeLeaveDays]
  );
  const capacityByName: Record<string, number> = React.useMemo(() => {
    const map: Record<string, number> = {};
    for (const d of devCaps) map[d.name] = d.capacity;
    return map;
  }, [devCaps]);

  // ── Draft rollups (pure — src/lib/draftPlan.ts) ─────────────────────────────

  const assignments = draftState.data?.assignments ?? {};
  const totals = React.useMemo(() => draftTotalsByAccount(assignments, poIssues), [assignments, poIssues]);
  const unplanned = React.useMemo(() => unplannedIssues(assignments, poIssues), [assignments, poIssues]);
  const staleTicketEntries = React.useMemo(
    () => staleDraftEntries(assignments, poIssues),
    [assignments, poIssues]
  );

  // Drafted entries whose member left the Dev roster (ticket still in-sprint —
  // otherwise it's already covered by staleTicketEntries above).
  const poIssueKeys = React.useMemo(() => new Set(poIssues.map((i) => i.key)), [poIssues]);
  const rosterIds = React.useMemo(() => new Set(devRoster.map((m) => m.accountId)), [devRoster]);
  const staleRosterEntries: StaleDraftEntry[] = React.useMemo(
    () =>
      Object.entries(assignments)
        .filter(([issueKey, a]) => poIssueKeys.has(issueKey) && !rosterIds.has(a.accountId))
        .map(([issueKey, assignment]) => ({ issueKey, assignment })),
    [assignments, poIssueKeys, rosterIds]
  );
  const needsAttention: StaleDraftEntry[] = [...staleTicketEntries, ...staleRosterEntries];

  // ── Mutations — optimistic full-replace via useDraftPlan.save ───────────────

  const [mutationError, setMutationError] = React.useState<string | null>(null);

  const persist = React.useCallback(
    async (nextAssignments: Record<string, DraftAssignment>, nextDevSprintId: number | null) => {
      setMutationError(null);
      try {
        await draftState.save(nextDevSprintId, nextAssignments);
      } catch (err: unknown) {
        const msg =
          err && typeof err === "object" && "message" in err
            ? String((err as { message: string }).message)
            : "Failed to save the draft plan";
        setMutationError(msg);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draftState.save]
  );

  const draftTo = React.useCallback(
    (issueKey: string, member: TeamMember) => {
      const next = {
        ...assignments,
        [issueKey]: { accountId: member.accountId, displayName: member.displayName },
      };
      void persist(next, effectiveDevSprintId);
    },
    [assignments, persist, effectiveDevSprintId]
  );

  const undraft = React.useCallback(
    (issueKey: string) => {
      const next = { ...assignments };
      delete next[issueKey];
      void persist(next, effectiveDevSprintId);
    },
    [assignments, persist, effectiveDevSprintId]
  );

  const changeDevSprint = React.useCallback(
    (newDevSprintId: number) => {
      void persist(assignments, newDevSprintId);
    },
    [assignments, persist]
  );

  const clearDraft = React.useCallback(() => {
    void persist({}, effectiveDevSprintId);
  }, [persist, effectiveDevSprintId]);

  // ── Footer summary ───────────────────────────────────────────────────────────

  const draftedCount = poIssues.length - unplanned.length;
  const draftedPoints = poIssues.reduce(
    (sum, i) => (assignments[i.key] ? sum + (i.storyPoints ?? 0) : sum),
    0
  );
  const totalCapacity = capacityKnown ? devCaps.reduce((sum, d) => sum + d.capacity, 0) : null;

  // ── Card header (always rendered — carries the draft-only note) ────────────

  const cardHeader = (
    <CardHeader className="pb-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" aria-hidden="true" />
          Draft Capacity Plan
        </h3>
        {/* a11y/UX: always visible — this card never writes to Jira. */}
        <span className="text-[0.6875rem] font-medium text-muted-foreground px-2 py-0.5 rounded-full border border-border bg-muted/40">
          Draft only — nothing is assigned in Jira.
        </span>
      </div>
    </CardHeader>
  );

  // ── No board/sprint context yet ─────────────────────────────────────────────

  if (devBoardId === undefined || sprintId == null) {
    return (
      <Card className="shadow-sm">
        {cardHeader}
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Select a sprint to draft a capacity plan against the Dev team.
          </p>
        </CardContent>
      </Card>
    );
  }

  // ── Loading skeleton ─────────────────────────────────────────────────────────

  if ((poSprintState.loading && !poSprintState.data) || (devTeamLoading && !devTeam)) {
    return (
      <Card className="shadow-sm">
        {cardHeader}
        {/* a11y: aria-busy while the sprint + roster load */}
        <CardContent aria-busy="true" aria-label="Loading draft capacity plan">
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10 w-full rounded" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Bridge-down / error state ───────────────────────────────────────────────

  const effectiveError = poSprintState.error ?? devTeamError ?? draftState.error;
  if (effectiveError && !poSprintState.data && !devTeam) {
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
              type="button"
              aria-label="Retry loading draft capacity plan"
              onClick={() => {
                poSprintState.run();
                devTeamRun();
                draftState.run();
              }}
            >
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Full render ──────────────────────────────────────────────────────────────

  const devSprintOptionCount = devFuture.length + devActive.length;

  return (
    <Card className="shadow-sm w-full max-w-full">
      {cardHeader}
      <CardContent className="space-y-4">
        {/* Dev sprint (capacity source) select */}
        <div className="flex items-end gap-3 flex-wrap">
          <div className="flex flex-col gap-0.5">
            <label
              htmlFor={devSprintSelectId}
              className="text-xs font-semibold text-muted-foreground uppercase tracking-wide"
            >
              Dev sprint (capacity source)
            </label>
            <select
              id={devSprintSelectId}
              aria-label="Dev sprint (capacity source)"
              className={selectCls + " max-w-xs"}
              value={effectiveDevSprintId ?? ""}
              disabled={devSprintListState.loading || devSprintOptionCount === 0}
              onChange={(e) => {
                const v = e.target.value;
                if (v !== "") changeDevSprint(parseInt(v, 10));
              }}
            >
              {devSprintOptionCount === 0 && !devSprintListState.loading && (
                <option value="">No dev sprints available</option>
              )}
              {devSprintListState.loading && <option value="">Loading…</option>}
              {devFuture.length > 0 && (
                <optgroup label="Future">
                  {devFuture.map((s) => (
                    <option key={s.id} value={s.id} title={s.name}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {devActive.length > 0 && (
                <optgroup label="Active">
                  {devActive.map((s) => (
                    <option key={s.id} value={s.id} title={s.name}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
          {!capacityKnown && (
            <p className="text-xs text-muted-foreground self-end mb-1.5">
              Capacity unknown — the paired Dev sprint has no dates yet. Drafting is still enabled.
            </p>
          )}
        </div>

        {/* Mutation error — non-blocking, announced */}
        {mutationError && (
          <p role="alert" aria-live="polite" className="text-xs text-destructive flex items-center gap-1.5">
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
            {mutationError}
          </p>
        )}

        {/* Two panes: unplanned tickets (left) | Dev tiles (right) */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(220px,1fr)_2fr] gap-4">
          {/* LEFT: Unplanned tickets — also a drop target that un-drafts */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const key = e.dataTransfer.getData("text/plain");
              if (key) undraft(key);
            }}
            className="rounded-lg border border-border bg-card p-3 min-h-[96px]"
          >
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Unplanned tickets{" "}
              <span className="ml-1.5 font-normal normal-case">({unplanned.length})</span>
            </p>
            {unplanned.length === 0 ? (
              <p className="text-sm text-muted-foreground">All sprint tickets are drafted.</p>
            ) : (
              <ul role="list" className="space-y-1.5">
                {unplanned.map((issue) => (
                  <UnplannedChip key={issue.key} issue={issue} roster={devRoster} onDraftTo={draftTo} />
                ))}
              </ul>
            )}
          </div>

          {/* RIGHT: one tile per Dev roster member */}
          <div>
            {devRoster.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No dev team members yet — use{" "}
                <span className="font-medium text-foreground">"Manage dev team"</span> below.
              </p>
            ) : (
              <ul role="list" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {devRoster.map((member) => (
                  <DevTile
                    key={member.accountId}
                    member={member}
                    capacity={capacityKnown ? capacityByName[member.displayName] ?? 0 : null}
                    drafted={totals[member.accountId] ?? { points: 0, count: 0, issues: [] }}
                    roster={devRoster}
                    onDraftTo={draftTo}
                    onRemove={undraft}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Needs attention — stale entries are surfaced, never silently dropped */}
        {needsAttention.length > 0 && (
          <div className="rounded-lg border border-warning-border bg-warning-bg px-4 py-3 space-y-2">
            <p className="text-xs font-semibold text-warning-foreground uppercase tracking-wide">
              Needs attention
            </p>
            <ul role="list" className="space-y-1.5">
              {needsAttention.map(({ issueKey, assignment }) => (
                <li key={issueKey} className="flex items-center gap-2 text-xs flex-wrap">
                  <span className="font-mono font-bold text-foreground">{issueKey}</span>
                  <span className="text-muted-foreground flex-1 min-w-0">
                    drafted to {assignment.displayName} —{" "}
                    {poIssueKeys.has(issueKey) ? "no longer on the Dev team" : "ticket left the sprint"}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 text-[0.6875rem]"
                    aria-label={`Remove ${issueKey} from draft`}
                    onClick={() => undraft(issueKey)}
                  >
                    Remove from draft
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Footer summary + Clear draft */}
        <div className="flex items-center justify-between gap-3 flex-wrap pt-2 border-t border-border">
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground tabular-nums">{draftedCount}</span>{" "}
            of{" "}
            <span className="font-semibold text-foreground tabular-nums">{poIssues.length}</span>{" "}
            tickets drafted ·{" "}
            <span className="font-semibold text-foreground tabular-nums">{formatPoints(draftedPoints)}</span>{" "}
            pts of{" "}
            <span className="font-semibold text-foreground tabular-nums">
              {totalCapacity !== null ? formatPoints(totalCapacity) : "—"}
            </span>{" "}
            pts capacity
          </p>
          <Button type="button" variant="outline" size="sm" aria-label="Clear draft" onClick={clearDraft}>
            Clear draft
          </Button>
        </div>

        {/* In-card Dev team manager — this is how the PO manages the DEV roster (ADR-019 rosters
            are per-board; the PO board's own "Manage team" edits the PO roster, not this one). */}
        <div className="space-y-1.5 pt-2 border-t border-border">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Dev team</p>
          <TeamManager boardId={devBoardId} onTeamChange={onTeamChange} />
        </div>
      </CardContent>
    </Card>
  );
}
