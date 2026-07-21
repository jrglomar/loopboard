// DraftPlanCard — Draft Capacity Plan (v1.68, ADR-079; v1.69, ADR-080;
// v1.70 pure-draft multi-developer redesign, ADR-081; CONTRACTS.md §4.30)
//
// PO-board-only Planning card: the PO drags PO-sprint tickets onto DEV-board
// team-member cards to build a DRAFT plan, splitting a ticket's points across
// several developers when the work is shared. It does exactly one job — check
// the sprint's ticket load against the team's capacity — and NEVER writes to
// Jira: not the draft assignments, not the per-share points, not a ticket's
// real fields. Real assignment and real ticket edits (points/status/move/
// rename/breakdown) live on the Assign Tickets card (ADR-081) — this card is a
// non-committing overlay only.
//
// Dev roster + capacity are read straight from the Dev board (useTeamMembers,
// useSprintList, useLeaves) — the same one-roster-per-board model as ADR-019,
// with an in-card TeamManager ("Dev team") so the PO never has to leave this page
// to fix the Dev roster.
//
// v1.70 (ADR-081): the draft model is per-developer POINT SHARES — an issue key
// maps to DraftShare[] (accountId, displayName, points), not one member. A big
// story can be split across several developers, each holding a draft slice of
// the points; over/under vs the ticket's real Jira points is allowed and never
// enforced (capacity is advisory, ADR-079). Layout is a full-width two-tier
// board: Developers on top (drop targets; capacity vs drafted load leads
// visually, since that match is the card's thesis), Sprint tickets on the
// bottom (real points read-only, an allocation indicator, drag + a native
// "Draft to a developer" select — ADR-009 a11y path). The v1.69 per-chip
// rename/status/move/breakdown editor is GONE from this card — relocated to
// Assign Tickets, which is the app's one real-edit surface.
//
// Drag-and-drop: native HTML5 DnD (ADR-079 — no dnd-kit/react-dnd dependency).
// Every draggable row also carries a native select — the keyboard/screen-reader
// path (ADR-009: native controls only).
//
// a11y: card section with heading; every interactive control has an aria-label;
// mutation errors are aria-live.
// perf: rollups (totals/allocated/unplanned/stale) are pure and derived per
// render from small inputs — no memoisation beyond React.useMemo guards.

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
import {
  draftTotalsByAccount,
  allocatedByIssue,
  unplannedIssues,
  staleShareEntries,
  type DraftMemberTotal,
} from "../lib/draftPlan";
import { computeCapacity, computeDevCapacity, sprintWorkingDays } from "../lib/capacity";
import { usePolicy } from "../lib/boards";
import { formatPoints } from "../lib/format";
import type { IssueSummary, SprintRef, TeamMember, DraftShare } from "../lib/types";

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

// ── Shared helpers ────────────────────────────────────────────────────────────

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function initialsOf(displayName: string): string {
  return displayName
    .split(" ")
    .map((w) => w[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");
}

// ── Share chip (v1.70, ADR-081) — one developer's draft points on one ticket ──

interface ShareChipProps {
  issue: IssueSummary;
  share: DraftShare;
  onSetPoints: (points: number) => void;
  onRemove: () => void;
}

function ShareChip({ issue, share, onSetPoints, onRemove }: ShareChipProps) {
  const [value, setValue] = React.useState(String(share.points));
  const committed = React.useRef(share.points);

  // Re-sync when the underlying share's points change (e.g. after a save resolves).
  React.useEffect(() => {
    setValue(String(share.points));
    committed.current = share.points;
  }, [share.points]);

  function commit() {
    const trimmed = value.trim();
    const num = Number(trimmed);
    if (trimmed === "" || !Number.isFinite(num) || num < 0) {
      setValue(String(committed.current)); // invalid/empty -> revert, never write a bad value
      return;
    }
    if (num === committed.current) return; // unchanged -> no write
    committed.current = num;
    onSetPoints(num);
  }

  return (
    <li className="flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-2 py-1.5 text-xs">
      <span className="font-mono font-bold text-foreground flex-shrink-0">{issue.key}</span>
      <span className="flex-1 min-w-0 truncate text-muted-foreground" title={issue.summary}>
        {truncate(issue.summary, 32)}
      </span>
      <input
        type="number"
        min={0}
        step="any"
        aria-label={`Draft points for ${issue.key} on ${share.displayName}`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
        }}
        // guard: scrolling the page over a number input must not change its value
        onWheel={(e) => (e.target as HTMLInputElement).blur()}
        className="w-14 h-7 text-xs px-1.5 text-right border border-border rounded-md bg-background text-foreground font-[inherit] focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 transition-colors hover:border-ring flex-shrink-0"
      />
      <button
        type="button"
        aria-label={`Remove ${issue.key} from ${share.displayName}`}
        onClick={onRemove}
        className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 focus:outline-none focus:ring-2 focus:ring-ring transition-colors flex-shrink-0"
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
    </li>
  );
}

// ── Developer capacity card (v1.70, ADR-081 — the top tier) ───────────────────

interface DevCapacityCardProps {
  member: TeamMember;
  /** The dev's capacity in points, or null when unknown (no dates) or still loading. */
  capacityValue: number | null;
  /** True only when dates ARE known but leaves are still loading — distinct from "unknown". */
  loadingCapacity: boolean;
  drafted: DraftMemberTotal;
  onDrop: (issueKey: string) => void;
  onSetPoints: (issueKey: string, accountId: string, points: number) => void;
  onRemove: (issueKey: string, accountId: string) => void;
}

function DevCapacityCard({
  member,
  capacityValue,
  loadingCapacity,
  drafted,
  onDrop,
  onSetPoints,
  onRemove,
}: DevCapacityCardProps) {
  let delta: React.ReactNode = null;
  if (capacityValue !== null) {
    const diff = capacityValue - drafted.points;
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

  // capacity text: "…" while a known sprint's leaves are still loading (never a stale
  // number), "—" when the paired sprint has no dates at all, else the real figure.
  const capacityText = loadingCapacity ? (
    <span aria-label="Loading capacity">…</span>
  ) : capacityValue !== null ? (
    formatPoints(capacityValue)
  ) : (
    "—"
  );

  return (
    <li
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const key = e.dataTransfer.getData("text/plain");
        if (key) onDrop(key);
      }}
      className="rounded-lg border border-border bg-card p-3 space-y-2.5"
    >
      <div className="flex items-center gap-2">
        {/* a11y: avatar is decorative */}
        <span
          aria-hidden="true"
          className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[0.625rem] font-bold text-primary flex-shrink-0"
        >
          {initialsOf(member.displayName)}
        </span>
        <span className="text-sm font-medium text-foreground flex-1 min-w-0 truncate">{member.displayName}</span>
        {delta}
      </div>
      <p className="text-xs text-muted-foreground">
        <span className="font-semibold text-foreground tabular-nums">{formatPoints(drafted.points)}</span>{" "}
        pts drafted ({drafted.count}) · capacity{" "}
        <span className="font-semibold text-foreground tabular-nums">{capacityText}</span>
      </p>
      {drafted.items.length > 0 ? (
        <ul role="list" className="space-y-1">
          {drafted.items.map(({ issue, points }) => (
            <ShareChip
              key={issue.key}
              issue={issue}
              share={{ accountId: member.accountId, displayName: member.displayName, points }}
              onSetPoints={(next) => onSetPoints(issue.key, member.accountId, next)}
              onRemove={() => onRemove(issue.key, member.accountId)}
            />
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground italic">Drop a ticket here to draft it.</p>
      )}
    </li>
  );
}

// ── Sprint ticket row (v1.70, ADR-081 — the bottom tier) ───────────────────────

interface SprintTicketRowProps {
  issue: IssueSummary;
  shares: DraftShare[];
  allocated: number;
  roster: TeamMember[];
  onDraftTo: (issueKey: string, member: TeamMember) => void;
}

function SprintTicketRow({ issue, shares, allocated, roster, onDraftTo }: SprintTicketRowProps) {
  const real = issue.storyPoints ?? 0;
  const notDrafted = allocated === 0;
  const overAllocated = allocated > real;
  // Only offer developers who don't already hold a share of this ticket — picking
  // one is always a MEANINGFUL action (a new split), never a silent de-dupe no-op.
  const addableRoster = roster.filter((m) => !shares.some((s) => s.accountId === m.accountId));

  return (
    <li
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/plain", issue.key)}
      className={`rounded-md border px-3 py-2 text-xs cursor-grab active:cursor-grabbing transition-colors ${
        notDrafted ? "border-primary/40 bg-primary/5" : "border-border bg-background"
      }`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <a
          href={issue.url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-xs font-bold text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-ring rounded flex-shrink-0"
          aria-label={`Open ${issue.key} in Jira`}
        >
          {issue.key}
        </a>
        <span className="min-w-[80px] flex-1 truncate text-foreground" title={issue.summary}>
          {issue.summary}
        </span>
        {/* Real Jira points — READ-ONLY, this card never writes them. */}
        <span className="text-muted-foreground whitespace-nowrap flex-shrink-0">{formatPoints(real)} pts</span>
        <span
          className={`whitespace-nowrap flex-shrink-0 ${
            !notDrafted && overAllocated ? "text-warning-foreground font-medium" : "text-muted-foreground"
          }`}
        >
          {notDrafted ? "Not drafted" : `${formatPoints(allocated)} of ${formatPoints(real)} pts drafted`}
        </span>
        {overAllocated && (
          <span className="text-[0.6875rem] font-semibold px-1.5 py-0.5 rounded-full bg-warning-bg text-warning-foreground border border-warning-border whitespace-nowrap flex-shrink-0">
            Over-allocated
          </span>
        )}
        {shares.length > 0 && (
          <span className="flex items-center gap-1 flex-wrap">
            {shares.map((s) => (
              <span
                key={s.accountId}
                className="text-[0.625rem] font-medium text-foreground px-1.5 py-0.5 rounded-full bg-muted whitespace-nowrap"
              >
                {s.displayName}
              </span>
            ))}
          </span>
        )}
        <select
          aria-label={`Draft ${issue.key} to a developer`}
          value=""
          disabled={addableRoster.length === 0}
          onChange={(e) => {
            const member = addableRoster.find((m) => m.accountId === e.target.value);
            if (member) onDraftTo(issue.key, member);
          }}
          className={selectCls}
        >
          <option value="">{addableRoster.length === 0 ? "All drafted" : "Draft to…"}</option>
          {addableRoster.map((m) => (
            <option key={m.accountId} value={m.accountId}>
              {m.displayName}
            </option>
          ))}
        </select>
      </div>
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

  // ── Dev sprint pairing (default) + effective selection (KEPT verbatim, ADR-080) ──

  const pairedDefault = React.useMemo(
    () => pairDevSprint(sprint, devActive, devFuture),
    [sprint, devActive, devFuture]
  );

  // v1.69 (ADR-080): the STORED choice — null until the PO explicitly picks one in the
  // select. Draft mutations persist THIS, never the effective/auto-paired one, so a
  // guessed pairing never sticks as if it had been chosen.
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
  // Only meaningful once dates exist — otherwise the card explains "no dates", not "loading".
  const showLoadingCapacity = capacityKnown && capacityLoading;

  // v1.69 (ADR-080): leave-day total across the roster + how many members have ≥1 day,
  // for the capacity-source transparency indicator under the select.
  const membersWithLeaveDays = React.useMemo(
    () => Object.values(capacity.byAssigneeLeaveDays).filter((d) => d > 0).length,
    [capacity.byAssigneeLeaveDays]
  );

  // ── Draft rollups (pure — src/lib/draftPlan.ts, v1.70 share model) ──────────

  const assignments = draftState.data?.assignments ?? {};
  const totals = React.useMemo(() => draftTotalsByAccount(assignments, poIssues), [assignments, poIssues]);
  const allocated = React.useMemo(() => allocatedByIssue(assignments), [assignments]);
  const unplanned = React.useMemo(() => unplannedIssues(assignments, poIssues), [assignments, poIssues]);
  const rosterIds = React.useMemo(() => new Set(devRoster.map((m) => m.accountId)), [devRoster]);
  const needsAttention = React.useMemo(
    () => staleShareEntries(assignments, poIssues, rosterIds),
    [assignments, poIssues, rosterIds]
  );

  // Bottom-tier ordering: undrafted tickets first (the queue), then the rest — a
  // stable partition that otherwise preserves each group's sprint-bucket order.
  const unplannedKeys = React.useMemo(() => new Set(unplanned.map((i) => i.key)), [unplanned]);
  const sortedPoIssues = React.useMemo(
    () => [
      ...poIssues.filter((i) => unplannedKeys.has(i.key)),
      ...poIssues.filter((i) => !unplannedKeys.has(i.key)),
    ],
    [poIssues, unplannedKeys]
  );

  // ── Mutations — optimistic full-replace via useDraftPlan.save (draft only) ──

  const [mutationError, setMutationError] = React.useState<string | null>(null);

  const persist = React.useCallback(
    async (nextAssignments: Record<string, DraftShare[]>, nextDevSprintId: number | null) => {
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

  // v1.70 (ADR-081): draftShare/setSharePoints/removeShare/clearDraft persist the
  // STORED devSprintId (null until chosen) — NOT the effective/auto-paired one. Only
  // changeDevSprint (an explicit pick) and "Reset to auto" ever write devSprintId itself.

  const draftShare = React.useCallback(
    (issueKey: string, member: TeamMember) => {
      const existing = assignments[issueKey] ?? [];
      if (existing.some((s) => s.accountId === member.accountId)) return; // already shared — no-op

      const issue = poIssues.find((i) => i.key === issueKey);
      const real = issue?.storyPoints ?? 0;
      const alreadyAllocated = allocated[issueKey] ?? 0;
      // First share on a ticket gets the full real points; a later share gets what's left.
      const points = existing.length > 0 ? Math.max(0, real - alreadyAllocated) : real;

      const next = {
        ...assignments,
        [issueKey]: [...existing, { accountId: member.accountId, displayName: member.displayName, points }],
      };
      void persist(next, storedDevSprintId);
    },
    [assignments, poIssues, allocated, persist, storedDevSprintId]
  );

  const setSharePoints = React.useCallback(
    (issueKey: string, accountId: string, points: number) => {
      if (!Number.isFinite(points) || points < 0) return; // invalid — never write
      const existing = assignments[issueKey];
      if (!existing) return;
      const next = {
        ...assignments,
        [issueKey]: existing.map((s) => (s.accountId === accountId ? { ...s, points } : s)),
      };
      void persist(next, storedDevSprintId);
    },
    [assignments, persist, storedDevSprintId]
  );

  const removeShare = React.useCallback(
    (issueKey: string, accountId: string) => {
      const existing = assignments[issueKey];
      if (!existing) return;
      const remaining = existing.filter((s) => s.accountId !== accountId);
      const next = { ...assignments };
      if (remaining.length === 0) {
        delete next[issueKey]; // an empty share array is invalid server-side — omit the key
      } else {
        next[issueKey] = remaining;
      }
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

  // ── Footer summary ───────────────────────────────────────────────────────────

  const draftedCount = poIssues.length - unplanned.length;
  // Team-wide drafted load = Σ every developer's share points (matches each dev
  // card's own "drafted" figure — deliberately NOT the tickets' real Jira points).
  const totalDraftedPoints = React.useMemo(
    () => Object.values(totals).reduce((sum, t) => sum + t.points, 0),
    [totals]
  );
  const totalCapacity = capacityKnown && !capacityLoading ? devCaps.reduce((sum, d) => sum + d.capacity, 0) : null;

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
  // roster exist; gated the same way the cards' own capacity number is.
  const showLeavesIndicator = capacityKnown && devRoster.length > 0;
  const leavesWarning = showLeavesIndicator && !capacityLoading && capacity.leavePersonDays === 0;

  return (
    <Card className="shadow-sm w-full max-w-full">
      {cardHeader}
      <CardContent className="space-y-5">
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

        {/* TOP TIER — Developers: full-width capacity board, the card's thesis */}
        <div role="region" aria-label="Developers" className="space-y-2">
          <h4 className="text-sm font-semibold text-foreground">
            Developers <span className="font-normal text-muted-foreground">({devRoster.length})</span>
          </h4>
          {devRoster.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No dev team members yet — use{" "}
              <span className="font-medium text-foreground">"Manage dev team"</span> below.
            </p>
          ) : (
            <ul role="list" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {devRoster.map((member) => {
                const capacityValue =
                  capacityKnown && !capacityLoading ? capacityByName[member.displayName] ?? 0 : null;
                return (
                  <DevCapacityCard
                    key={member.accountId}
                    member={member}
                    capacityValue={capacityValue}
                    loadingCapacity={showLoadingCapacity}
                    drafted={totals[member.accountId] ?? { points: 0, count: 0, items: [] }}
                    onDrop={(issueKey) => draftShare(issueKey, member)}
                    onSetPoints={setSharePoints}
                    onRemove={removeShare}
                  />
                );
              })}
            </ul>
          )}
        </div>

        {/* BOTTOM TIER — Sprint tickets: full width, undrafted tickets lead the queue */}
        <div role="region" aria-label="Sprint tickets" className="space-y-2 pt-3 border-t border-border">
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Sprint tickets <span className="ml-1 font-normal normal-case">({poIssues.length})</span>
            </h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              Drag a ticket onto a developer to draft it, or choose one from its menu.
            </p>
          </div>
          {poIssues.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tickets in this sprint yet.</p>
          ) : (
            <ul role="list" className="space-y-1.5">
              {sortedPoIssues.map((issue) => (
                <SprintTicketRow
                  key={issue.key}
                  issue={issue}
                  shares={assignments[issue.key] ?? []}
                  allocated={allocated[issue.key] ?? 0}
                  roster={devRoster}
                  onDraftTo={draftShare}
                />
              ))}
            </ul>
          )}
        </div>

        {/* Needs attention — stale shares are surfaced, never silently dropped */}
        {needsAttention.length > 0 && (
          <div className="rounded-lg border border-warning-border bg-warning-bg px-4 py-3 space-y-2">
            <p className="text-xs font-semibold text-warning-foreground uppercase tracking-wide">
              Needs attention
            </p>
            <ul role="list" className="space-y-1.5">
              {needsAttention.map(({ issueKey, share, reason }) => (
                <li key={`${issueKey}-${share.accountId}`} className="flex items-center gap-2 text-xs flex-wrap">
                  <span className="font-mono font-bold text-foreground">{issueKey}</span>
                  <span className="text-muted-foreground flex-1 min-w-0">
                    {formatPoints(share.points)} pts drafted to {share.displayName} —{" "}
                    {reason === "ticket-gone" ? "ticket left the sprint" : "no longer on the Dev team"}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 text-[0.6875rem]"
                    aria-label={`Remove ${share.displayName}'s draft share of ${issueKey}`}
                    onClick={() => removeShare(issueKey, share.accountId)}
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
            <span className="font-semibold text-foreground tabular-nums">{formatPoints(totalDraftedPoints)}</span>{" "}
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
