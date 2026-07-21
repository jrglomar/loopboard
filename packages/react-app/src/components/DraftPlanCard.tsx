// DraftPlanCard — Draft Capacity Plan (v1.68, ADR-079; v1.69, ADR-080; CONTRACTS.md §4.30)
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
// v1.69 (ADR-080): chips gain the same per-ticket actions as the Assign Tickets
// table (rename/status/move — shared ./ticketCells) behind a per-chip "Edit"
// expander, plus "Break down" (BreakdownDialog) to split an oversized story into
// several new PO stories. A move initiated from a chip also removes its draft
// entry in the same action. Draft mutations (draftTo/undraft/clearDraft/a
// move-triggered removal) persist the STORED devSprintId (null until the PO
// explicitly picks one) instead of the effective (possibly auto-paired) one —
// auto-pairing is EPHEMERAL, never a persisted side effect of drafting — and the
// card now surfaces WHY capacity looks the way it does (leaves found / not found
// under the paired Dev sprint; a loading placeholder while leaves load, instead
// of flashing full-confidence numbers).
//
// a11y: card section with heading; every interactive control has an aria-label;
// mutation errors are aria-live.
// perf: rollups (totals/unplanned/stale) are pure and derived per render from
// small inputs — no memoisation beyond React.useMemo guards against churn.

import React from "react";
import { Target, AlertCircle, X, Pencil } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { TeamManager } from "./TeamManager";
import { PointsCell, StatusCell, MoveSprintCell, SummaryCell } from "./ticketCells";
import { BreakdownDialog } from "./BreakdownDialog";
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
  /** v1.69 (ADR-080): PO board active+future sprints — each chip's move-to-sprint control. */
  sprints?: SprintRef[];
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// ── Chip edit panel (v1.69, ADR-080) — rename / status / move / break down ─────

interface ChipEditPanelProps {
  issue: IssueSummary;
  sprints: SprintRef[];
  onFieldSaved: () => void;
  onMoved: (issueKey: string) => void;
  onBreakdown: (issue: IssueSummary) => void;
}

function ChipEditPanel({ issue, sprints, onFieldSaved, onMoved, onBreakdown }: ChipEditPanelProps) {
  return (
    <div className="border-t border-border/60 px-2 py-2 space-y-2">
      <div className="space-y-1.5">
        <div>
          <span className="text-[0.625rem] font-semibold text-muted-foreground uppercase tracking-wide block mb-0.5">
            Summary
          </span>
          <SummaryCell issue={issue} onSaved={onFieldSaved} />
        </div>
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <span className="text-[0.625rem] font-semibold text-muted-foreground uppercase tracking-wide block mb-0.5">
              Status
            </span>
            <StatusCell issue={issue} onChanged={onFieldSaved} />
          </div>
          <div>
            <span className="text-[0.625rem] font-semibold text-muted-foreground uppercase tracking-wide block mb-0.5">
              Move
            </span>
            <MoveSprintCell issue={issue} sprints={sprints} onMoved={() => onMoved(issue.key)} />
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-border/50">
        <p className="text-[0.625rem] text-muted-foreground italic">
          These edits change the real Jira ticket.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-6 text-[0.6875rem] flex-shrink-0"
          onClick={() => onBreakdown(issue)}
          aria-label={`Break down ${issue.key}`}
        >
          Break down
        </Button>
      </div>
    </div>
  );
}

// ── Unplanned ticket chip ─────────────────────────────────────────────────────

interface UnplannedChipProps {
  issue: IssueSummary;
  roster: TeamMember[];
  sprints: SprintRef[];
  onDraftTo: (issueKey: string, member: TeamMember) => void;
  /** v1.69 (ADR-080): a points/rename/status edit refetches the PO sprint. */
  onFieldSaved: () => void;
  /** v1.69 (ADR-080): a move from this chip also drops its (nonexistent, here) draft entry. */
  onMoved: (issueKey: string) => void;
  onBreakdown: (issue: IssueSummary) => void;
}

function UnplannedChip({ issue, roster, sprints, onDraftTo, onFieldSaved, onMoved, onBreakdown }: UnplannedChipProps) {
  const [expanded, setExpanded] = React.useState(false);

  return (
    <li
      // v1.69.1: draggable only while collapsed — HTML5 drag on a draggable ancestor
      // hijacks mouse text-selection inside the expanded panel's inputs (SummaryCell's
      // rename field, PointsCell's number field), turning a text-select attempt into a
      // chip drag in Chromium/Firefox. onDragStart simply won't fire when draggable=false.
      draggable={!expanded}
      onDragStart={(e) => e.dataTransfer.setData("text/plain", issue.key)}
      className={`rounded-md border border-border bg-background text-xs ${expanded ? "cursor-default" : "cursor-grab active:cursor-grabbing"}`}
    >
      <div title={issue.summary} className="flex items-center gap-1.5 px-2 py-1.5">
        <span className="font-mono font-bold text-foreground flex-shrink-0">{issue.key}</span>
        <span className="flex-1 min-w-0 truncate text-muted-foreground">{truncate(issue.summary, 40)}</span>
        <PointsCell issue={issue} onSaved={onFieldSaved} />
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
        <button
          type="button"
          aria-label={`Edit ${issue.key}`}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring transition-colors flex-shrink-0"
        >
          <Pencil className="h-3 w-3" aria-hidden="true" />
        </button>
      </div>
      {expanded && (
        <ChipEditPanel
          issue={issue}
          sprints={sprints}
          onFieldSaved={onFieldSaved}
          onMoved={onMoved}
          onBreakdown={onBreakdown}
        />
      )}
    </li>
  );
}

// ── Drafted ticket chip (v1.69, ADR-080 — extracted from DevTile for the shared edit panel) ─

interface DraftedChipProps {
  issue: IssueSummary;
  member: TeamMember;
  roster: TeamMember[];
  sprints: SprintRef[];
  onDraftTo: (issueKey: string, member: TeamMember) => void;
  onRemove: (issueKey: string) => void;
  onFieldSaved: () => void;
  onMoved: (issueKey: string) => void;
  onBreakdown: (issue: IssueSummary) => void;
}

function DraftedChip({
  issue,
  member,
  roster,
  sprints,
  onDraftTo,
  onRemove,
  onFieldSaved,
  onMoved,
  onBreakdown,
}: DraftedChipProps) {
  const [expanded, setExpanded] = React.useState(false);

  return (
    <li className="rounded-md border border-border/60 bg-background text-xs">
      <div title={issue.summary} className="flex items-center gap-1.5 px-2 py-1">
        <span className="font-mono font-bold text-foreground flex-shrink-0">{issue.key}</span>
        <span className="flex-1 min-w-0 truncate text-muted-foreground">{truncate(issue.summary, 40)}</span>
        <PointsCell issue={issue} onSaved={onFieldSaved} />
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
        <button
          type="button"
          aria-label={`Edit ${issue.key}`}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring transition-colors flex-shrink-0"
        >
          <Pencil className="h-3 w-3" aria-hidden="true" />
        </button>
      </div>
      {expanded && (
        <ChipEditPanel
          issue={issue}
          sprints={sprints}
          onFieldSaved={onFieldSaved}
          onMoved={onMoved}
          onBreakdown={onBreakdown}
        />
      )}
    </li>
  );
}

// ── Developer tile ────────────────────────────────────────────────────────────

interface DevTileProps {
  member: TeamMember;
  capacity: number | null;
  drafted: { points: number; count: number; issues: IssueSummary[] };
  roster: TeamMember[];
  sprints: SprintRef[];
  onDraftTo: (issueKey: string, member: TeamMember) => void;
  onRemove: (issueKey: string) => void;
  onFieldSaved: () => void;
  onMoved: (issueKey: string) => void;
  onBreakdown: (issue: IssueSummary) => void;
}

function DevTile({
  member,
  capacity,
  drafted,
  roster,
  sprints,
  onDraftTo,
  onRemove,
  onFieldSaved,
  onMoved,
  onBreakdown,
}: DevTileProps) {
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
            <DraftedChip
              key={issue.key}
              issue={issue}
              member={member}
              roster={roster}
              sprints={sprints}
              onDraftTo={onDraftTo}
              onRemove={onRemove}
              onFieldSaved={onFieldSaved}
              onMoved={onMoved}
              onBreakdown={onBreakdown}
            />
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
  sprints = [],
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

  // v1.69 (ADR-080): the STORED choice — null until the PO explicitly picks one in the
  // select. Draft mutations persist THIS, never the effective/auto-paired one, so a
  // guessed pairing never sticks as if it had been chosen (root cause (b) of the
  // "everyone shows 8" report).
  const storedDevSprintId: number | null = draftState.data?.devSprintId ?? null;
  const isAutoPaired = storedDevSprintId === null && pairedDefault !== undefined;

  const effectiveDevSprintId: number | null = storedDevSprintId ?? pairedDefault?.id ?? null;

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

  // v1.69 (ADR-080): while leaves are loading, capacity is UNKNOWN — never render a
  // full-confidence number sourced from the PREVIOUS sprint's (possibly stale) leaves.
  const capacityLoading = leavesState.loading;

  // v1.69 (ADR-080): leave-day total across the roster + how many members have ≥1 day,
  // for the capacity-source transparency indicator under the select.
  const membersWithLeaveDays = React.useMemo(
    () => Object.values(capacity.byAssigneeLeaveDays).filter((d) => d > 0).length,
    [capacity.byAssigneeLeaveDays]
  );

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
  const [breakdownIssue, setBreakdownIssue] = React.useState<IssueSummary | null>(null);

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

  // v1.69 (ADR-080): draftTo/undraft/clearDraft persist the STORED devSprintId (null
  // until chosen) — NOT the effective/auto-paired one. Only changeDevSprint (an
  // explicit pick) and "Reset to auto" ever write devSprintId itself.
  const draftTo = React.useCallback(
    (issueKey: string, member: TeamMember) => {
      const next = {
        ...assignments,
        [issueKey]: { accountId: member.accountId, displayName: member.displayName },
      };
      void persist(next, storedDevSprintId);
    },
    [assignments, persist, storedDevSprintId]
  );

  const undraft = React.useCallback(
    (issueKey: string) => {
      const next = { ...assignments };
      delete next[issueKey];
      void persist(next, storedDevSprintId);
    },
    [assignments, persist, storedDevSprintId]
  );

  const changeDevSprint = React.useCallback(
    (newDevSprintId: number) => {
      void persist(assignments, newDevSprintId);
    },
    [assignments, persist]
  );

  const resetToAuto = React.useCallback(() => {
    void persist(assignments, null);
  }, [assignments, persist]);

  const clearDraft = React.useCallback(() => {
    void persist({}, storedDevSprintId);
  }, [persist, storedDevSprintId]);

  // v1.69 (ADR-080): a move initiated FROM this card also removes the ticket's draft
  // entry in the same action (a deliberate move must not leave a "Needs attention"
  // stale row), then refetches the PO sprint either way — a moved ticket has left it.
  const handleTicketMoved = React.useCallback(
    (issueKey: string) => {
      if (issueKey in assignments) {
        const next = { ...assignments };
        delete next[issueKey];
        void persist(next, storedDevSprintId).then(() => poSprintState.run());
      } else {
        poSprintState.run();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assignments, persist, storedDevSprintId]
  );

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

  // v1.69 (ADR-080): capacity-source transparency — only meaningful once dates AND a
  // roster exist; gated the same way the tiles' own capacity number is.
  const showLeavesIndicator = capacityKnown && devRoster.length > 0;
  const leavesWarning = showLeavesIndicator && !capacityLoading && capacity.leavePersonDays === 0;

  return (
    <Card className="shadow-sm w-full max-w-full">
      {cardHeader}
      <CardContent className="space-y-4">
        {/* Dev sprint (capacity source) select */}
        <div className="space-y-1">
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
            {/* v1.69 (ADR-080): auto-pairing is ephemeral — a visible label, never a silent guess */}
            {isAutoPaired && (
              <span
                className="text-[0.6875rem] font-medium text-muted-foreground px-1.5 py-0.5 rounded-full bg-muted self-end mb-1.5 whitespace-nowrap"
                title="Paired by date overlap with the PO sprint. Pick a Dev sprint above to override."
                aria-label="Auto-paired by date overlap with the PO sprint"
              >
                Auto-paired
              </span>
            )}
            {storedDevSprintId != null && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-xs self-end"
                aria-label="Reset to auto"
                onClick={resetToAuto}
              >
                Reset to auto
              </Button>
            )}
            {!capacityKnown && (
              <p className="text-xs text-muted-foreground self-end mb-1.5">
                Capacity unknown — the paired Dev sprint has no dates yet. Drafting is still enabled.
              </p>
            )}
          </div>
          {/* v1.69 (ADR-080): capacity-source transparency — fixes the silent "every dev shows 8" state */}
          {showLeavesIndicator && (
            <p className={`text-xs ${leavesWarning ? "text-warning-foreground" : "text-muted-foreground"}`}>
              {capacityLoading
                ? "Loading leaves…"
                : capacity.leavePersonDays > 0
                ? `${capacity.leavePersonDays} leave/offset day(s) found across ${membersWithLeaveDays} member(s)`
                : "No leaves or offsets recorded under this Dev sprint — pick the sprint where the team plotted them (Dev-board Planning or the Offset Tracker)."}
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
                  <UnplannedChip
                    key={issue.key}
                    issue={issue}
                    roster={devRoster}
                    sprints={sprints}
                    onDraftTo={draftTo}
                    onFieldSaved={poSprintState.run}
                    onMoved={handleTicketMoved}
                    onBreakdown={setBreakdownIssue}
                  />
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
                    capacity={capacityKnown && !capacityLoading ? capacityByName[member.displayName] ?? 0 : null}
                    drafted={totals[member.accountId] ?? { points: 0, count: 0, issues: [] }}
                    roster={devRoster}
                    sprints={sprints}
                    onDraftTo={draftTo}
                    onRemove={undraft}
                    onFieldSaved={poSprintState.run}
                    onMoved={handleTicketMoved}
                    onBreakdown={setBreakdownIssue}
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

      {/* Breakdown dialog (v1.69, ADR-080) — split an oversized story into new PO stories.
          Keyed by issue key so switching chips remounts it with a fresh row set. */}
      {breakdownIssue && (
        <BreakdownDialog
          key={breakdownIssue.key}
          issue={breakdownIssue}
          sprintId={sprintId}
          onClose={() => setBreakdownIssue(null)}
          onCreated={poSprintState.run}
        />
      )}
    </Card>
  );
}
