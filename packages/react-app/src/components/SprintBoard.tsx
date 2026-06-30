import React, { useId, useState, useEffect } from "react";
import {
  Calendar,
  Target,
  ListTodo,
  Loader,
  GitPullRequest,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import {
  type GetActiveSprintOutput,
  type IssueSummary,
  type ActiveSprintRef,
  type LinkedPr,
} from "../lib/types";
import { type McpError } from "../lib/mcpClient";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PrBadge } from "./PrBadge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import {
  computeProgress,
  computeTimeline,
  computePace,
  type PaceStatus,
} from "../lib/sprintMetrics";
import { deriveInitials } from "../lib/huddleRegroup";
import { formatPoints } from "../lib/format";

// ── Props ─────────────────────────────────────────────────────────────────────

interface SprintBoardProps {
  data: GetActiveSprintOutput | null;
  loading: boolean;
  error: McpError | null;
  onRefresh: () => void;
  /** v1.1: called when the user selects a different active sprint (ADR-007) */
  onSelectSprint?: (id: number) => void;
  /** v1.2: active assignee filter (null = All) */
  assigneeFilter?: string | null;
  /** v1.2: called when user selects a new assignee filter value */
  onAssigneeFilterChange?: (assignee: string | null) => void;
  /** v1.4: "New Sprint" button rendered in controls zone (provided by Dashboard) */
  createSprintButton?: React.ReactNode;
  /** v1.27 (ADR-039): linked PRs per issue key — drives the "has PR" badge on cards. */
  prsByKey?: Record<string, LinkedPr[]>;
}

// ── Column config (v1.3: icon + filled tinted band) ──────────────────────────

const COLUMN_CONFIG = {
  todo: {
    title: "To Do",
    icon: ListTodo,
    // Tailwind tint classes using the token group
    bandBg:  "bg-[hsl(var(--status-todo-bg))]",
    bandBorder: "border-[hsl(var(--status-todo-border))]",
    iconClass: "text-[hsl(var(--status-todo-text))]",
    textClass: "text-[hsl(var(--status-todo-text))]",
    badgeBg: "bg-[hsl(var(--status-todo-bg))] text-[hsl(var(--status-todo-text))] border-[hsl(var(--status-todo-border))]",
  },
  inprogress: {
    title: "In Progress",
    icon: Loader,
    bandBg:  "bg-[hsl(var(--status-inprogress-bg))]",
    bandBorder: "border-[hsl(var(--status-inprogress-border))]",
    iconClass: "text-[hsl(var(--status-inprogress-text))]",
    textClass: "text-[hsl(var(--status-inprogress-text))]",
    badgeBg: "bg-[hsl(var(--status-inprogress-bg))] text-[hsl(var(--status-inprogress-text))] border-[hsl(var(--status-inprogress-border))]",
  },
  codereview: {
    title: "Code Review",
    icon: GitPullRequest,
    bandBg:  "bg-[hsl(var(--status-codereview-bg))]",
    bandBorder: "border-[hsl(var(--status-codereview-border))]",
    iconClass: "text-[hsl(var(--status-codereview-text))]",
    textClass: "text-[hsl(var(--status-codereview-text))]",
    badgeBg: "bg-[hsl(var(--status-codereview-bg))] text-[hsl(var(--status-codereview-text))] border-[hsl(var(--status-codereview-border))]",
  },
  done: {
    title: "Done",
    icon: CheckCircle2,
    bandBg:  "bg-[hsl(var(--status-done-bg))]",
    bandBorder: "border-[hsl(var(--status-done-border))]",
    iconClass: "text-[hsl(var(--status-done-text))]",
    textClass: "text-[hsl(var(--status-done-text))]",
    badgeBg: "bg-[hsl(var(--status-done-bg))] text-[hsl(var(--status-done-text))] border-[hsl(var(--status-done-border))]",
  },
} as const;

type ColKey = keyof typeof COLUMN_CONFIG;

// ── Initials Avatar ───────────────────────────────────────────────────────────

function InitialsAvatar({ name }: { name: string | null }) {
  const initials = deriveInitials(name);
  return (
    <span
      className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[0.5625rem] font-bold flex-shrink-0"
      aria-hidden="true"
      title={name ?? "Unassigned"}
    >
      {initials}
    </span>
  );
}

// ── Issue Card ────────────────────────────────────────────────────────────────

function IssueCard({ issue, prs }: { issue: IssueSummary; prs?: LinkedPr[] }) {
  const isBlocked = issue.blocked;

  return (
    // a11y: article with labelled heading for each issue card
    // perf: 150ms color/shadow transition, -translate-y-px on hover (reduced-motion safe)
    <Card
      className={cn(
        "transition-card-full hover:shadow-sm hover:-translate-y-px hover:border-ring",
        "motion-reduce:transform-none",
        isBlocked && "border-l-4 border-l-destructive bg-[hsl(var(--error-bg))]"
      )}
      aria-label={`${issue.key}: ${issue.summary}`}
    >
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-2 mb-1">
          {/* a11y: font-mono key link */}
          <a
            className="text-xs font-bold text-primary font-mono flex-shrink-0 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm"
            href={issue.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${issue.key} in Jira`}
          >
            {issue.key}
          </a>
          <div className="flex gap-1 items-center flex-shrink-0 flex-wrap justify-end">
            {isBlocked && (
              // a11y: role="status" + visually prominent
              <Badge
                variant="destructive"
                role="status"
                aria-label="Blocked"
                className="text-[0.625rem] px-1.5 py-0 h-4"
              >
                ⚠ Blocked
              </Badge>
            )}
            <Badge variant="secondary" className="text-[0.625rem] px-1.5 py-0 h-4">
              {issue.issueType}
            </Badge>
          </div>
        </div>

        <p className="text-sm text-foreground leading-snug mb-2 break-words">
          {issue.summary}
        </p>

        <div className="flex items-center justify-between gap-2">
          {/* v1.3: initials avatar chip next to assignee name */}
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground truncate">
            <InitialsAvatar name={issue.assignee} />
            <span className="truncate">{issue.assignee ?? "Unassigned"}</span>
          </span>
          <div className="flex items-center gap-1 flex-shrink-0">
            {/* v1.27 (ADR-039): linked-PR badge — clickable, opens newest PR */}
            <PrBadge prs={prs} />
            {issue.storyPoints != null && (
              <Badge
                variant="outline"
                className="text-xs font-semibold flex-shrink-0"
                title="Story points"
              >
                {issue.storyPoints} pt{issue.storyPoints !== 1 ? "s" : ""}
              </Badge>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Column ────────────────────────────────────────────────────────────────────

interface ColumnProps {
  colorKey: ColKey;
  issues: IssueSummary[];
  /** v1.27 (ADR-039): linked PRs per issue key for the card badge. */
  prsByKey?: Record<string, LinkedPr[]>;
}

function SprintColumn({ colorKey, issues, prsByKey }: ColumnProps) {
  const cfg = COLUMN_CONFIG[colorKey];
  const Icon = cfg.icon;

  return (
    // a11y: region landmark per column
    <section
      className="bg-muted/50 border border-border rounded-lg overflow-hidden"
      aria-label={`${cfg.title} column`}
    >
      {/* Filled tinted band — v1.3 column header */}
      <div
        className={cn(
          "flex items-center justify-between px-3 py-2 border-b",
          cfg.bandBg,
          cfg.bandBorder
        )}
      >
        <div className="flex items-center gap-1.5">
          <Icon className={cn("h-3.5 w-3.5 flex-shrink-0", cfg.iconClass)} aria-hidden="true" />
          <h3 className={cn("text-xs font-medium uppercase tracking-wide", cfg.textClass)}>
            {cfg.title}
          </h3>
        </div>
        {/* Colored count badge */}
        <span
          className={cn(
            "text-xs font-semibold tabular-nums px-1.5 py-0.5 rounded-md border",
            cfg.badgeBg
          )}
          aria-label={`${issues.length} issues`}
        >
          {issues.length}
        </span>
      </div>

      <div className="p-3">
        {issues.length === 0 ? (
          <p className="text-muted-foreground text-xs py-2">No issues</p>
        ) : (
          <ul className="flex flex-col gap-2" style={{ listStyle: "none" }}>
            {issues.map((issue) => (
              <li key={issue.key}>
                <IssueCard issue={issue} prs={prsByKey?.[issue.key]} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function SprintSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading sprint board">
      <div className="border border-border rounded-lg p-4 mb-4 bg-card shadow-sm">
        <Skeleton className="h-6 w-2/5 mb-3" />
        <Skeleton className="h-3.5 w-1/3 mb-2" />
        <Skeleton className="h-3.5 w-1/4 mb-2" />
        <Skeleton className="h-2 w-full mb-1 rounded-full" />
        <Skeleton className="h-3 w-1/3" />
      </div>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {(["todo", "inprogress", "codereview", "done"] as const).map((col) => (
          <div key={col} className="bg-muted/50 border border-border rounded-lg overflow-hidden">
            <div className="px-3 py-2 border-b bg-muted">
              <Skeleton className="h-3.5 w-3/5" />
            </div>
            <div className="p-3 flex flex-col gap-2">
              <Skeleton className="h-20 w-full rounded-lg" />
              <Skeleton className="h-16 w-full rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Sprint Selector (v1.1 + v1.4 future sprints, native <select>, ADR-009) ───

interface SprintSelectorProps {
  activeSprints: ActiveSprintRef[];
  /** v1.4: future sprints to show in a second optgroup (earliest-first) */
  futureSprints: ActiveSprintRef[];
  currentSprintId: number;
  onSelectSprint: (id: number) => void;
}

function SprintSelector({ activeSprints, futureSprints, currentSprintId, onSelectSprint }: SprintSelectorProps) {
  const selectId = useId();
  // v1.4: show selector when active + future combined > 1 (CONTRACTS.md §6)
  const totalSelectable = activeSprints.length + futureSprints.length;
  if (totalSelectable <= 1) return null;

  // v1.3: shorten label "Arsenic · Jun 4–17", full name in title attr
  const formatShortLabel = (s: ActiveSprintRef): string => {
    const sprintName = s.name;
    if (!s.startDate && !s.endDate) return sprintName;
    const fmt = (d: string | null) => {
      if (!d) return null;
      try {
        return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
      } catch {
        return d.slice(0, 10);
      }
    };
    const start = fmt(s.startDate);
    const end   = fmt(s.endDate);
    const dates = start && end ? `${start}–${end}` : start ?? end ?? "";
    return dates ? `${sprintName} · ${dates}` : sprintName;
  };

  return (
    <div className="flex flex-col gap-0.5 flex-shrink-0">
      <label
        htmlFor={selectId}
        className="text-xs font-semibold text-muted-foreground"
      >
        Sprint
      </label>
      {/* a11y: native <select> — fully keyboard accessible; ADR-009 */}
      <select
        id={selectId}
        className="h-9 text-xs px-2 border border-border rounded-md bg-background text-foreground font-[inherit] cursor-pointer max-w-[300px] focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 transition-card hover:border-ring"
        value={currentSprintId}
        onChange={(e) => onSelectSprint(parseInt(e.target.value, 10))}
        aria-label="Select sprint"
      >
        {/* Active sprints optgroup — only rendered when active sprints exist */}
        {activeSprints.length > 0 && (
          <optgroup label="Active">
            {activeSprints.map((s) => (
              <option key={s.id} value={s.id} title={s.name}>
                {formatShortLabel(s)}
              </option>
            ))}
          </optgroup>
        )}
        {/* v1.4: Future sprints optgroup — earliest-first (CONTRACTS.md §4.3) */}
        {futureSprints.length > 0 && (
          <optgroup label="Future">
            {futureSprints.map((s) => (
              <option key={s.id} value={s.id} title={s.name}>
                {formatShortLabel(s)}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </div>
  );
}

// ── Assignee Filter (v1.2, native <select>, ADR-009) ─────────────────────────

interface AssigneeFilterProps {
  assignees: string[];
  hasUnassigned: boolean;
  activeFilter: string | null;
  onFilterChange: (assignee: string | null) => void;
}

function AssigneeFilter({ assignees, hasUnassigned, activeFilter, onFilterChange }: AssigneeFilterProps) {
  const selectId = useId();
  const totalOptions = assignees.length + (hasUnassigned ? 1 : 0);
  if (totalOptions === 0) return null;

  return (
    <div className="flex flex-col gap-0.5">
      <label
        htmlFor={selectId}
        className="text-xs font-semibold text-muted-foreground"
      >
        Assignee
      </label>
      <select
        id={selectId}
        className="h-9 text-xs px-2 border border-border rounded-md bg-background text-foreground font-[inherit] cursor-pointer max-w-[180px] focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 transition-card hover:border-ring"
        value={activeFilter ?? ""}
        onChange={(e) => {
          const val = e.target.value;
          if (val === "") onFilterChange(null);
          else if (val === "__unassigned__") onFilterChange("__unassigned__");
          else onFilterChange(val);
        }}
        aria-label="Filter by assignee"
      >
        <option value="">All</option>
        {assignees.map((a) => (
          <option key={a} value={a}>{a}</option>
        ))}
        {hasUnassigned && <option value="__unassigned__">Unassigned</option>}
      </select>
    </div>
  );
}

// ── Sprint Progress + Pace (v1.3) ─────────────────────────────────────────────

interface SprintProgressProps {
  data: GetActiveSprintOutput;
}

function SprintProgress({ data }: SprintProgressProps) {
  const { totals, sprint } = data;
  // v1.5 DoD (ADR-014): pass storyPointsCodeReview so computeProgress uses done+review
  const progress = computeProgress(totals);
  const timeline = computeTimeline(sprint.startDate, sprint.endDate);
  const pace = computePace(
    timeline?.elapsedPct ?? null,
    progress.pointsPct
  );
  // DoD-completed label: done + code-review (ADR-014)
  const dodCompletedPts = totals.storyPointsDone + (totals.storyPointsCodeReview ?? 0);

  const paceColors: Record<PaceStatus, string> = {
    on_track: "bg-success-bg text-success border-success-border",
    behind:   "bg-warning-bg text-warning-foreground border-warning-border",
    ahead:    "bg-info-bg text-info border-info-border",
  };
  const paceLabels: Record<PaceStatus, string> = {
    on_track: "On track",
    behind:   "Behind",
    ahead:    "Ahead",
  };

  return (
    <div className="mt-3 space-y-2">
      {/* Story points progress bar */}
      {progress.hasEstimates ? (
        <div>
          <div className="flex items-center justify-between mb-1 gap-2">
            <span className="text-xs text-muted-foreground font-medium">
              {/* v1.5 DoD: done + code-review shown as completed (ADR-014) */}
              {dodCompletedPts} / {totals.storyPointsTotal} pts
            </span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground tabular-nums">
                {progress.issuesDone}/{progress.issuesTotal} issues
              </span>
              {/* Pace chip — heuristic, clearly labeled */}
              {pace && (
                <span
                  className={cn(
                    "text-[0.625rem] font-semibold px-1.5 py-0.5 rounded-full border",
                    paceColors[pace]
                  )}
                  title="Heuristic pace indicator — % time elapsed vs % points done"
                  // a11y: role="status" so screen readers pick it up
                  role="status"
                >
                  {paceLabels[pace]}
                </span>
              )}
            </div>
          </div>
          {/* a11y: role="progressbar" with aria-valuenow/min/max */}
          <div
            role="progressbar"
            aria-valuenow={progress.pointsPct ?? 0}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${progress.pointsPct ?? 0}% story points done`}
            className="h-2 bg-border rounded-full overflow-hidden"
          >
            <div
              className="h-full bg-success rounded-full transition-card"
              style={{ width: `${progress.pointsPct ?? 0}%` }}
            />
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground italic">No estimates</span>
          <span className="text-xs text-muted-foreground">
            {progress.issuesDone}/{progress.issuesTotal} issues
          </span>
        </div>
      )}

      {/* Sprint timeline — hidden when dates null */}
      {timeline && (
        <div>
          <div className="flex items-center justify-between mb-1 gap-2">
            <span className="text-xs text-muted-foreground">
              Day {timeline.dayOfN} of {timeline.totalDays} · {timeline.daysLeft} day{timeline.daysLeft !== 1 ? "s" : ""} left
            </span>
          </div>
          {/* Thin elapsed bar */}
          <div
            className="h-1 bg-border rounded-full overflow-hidden"
            aria-hidden="true"
          >
            <div
              className="h-full bg-muted-foreground/40 rounded-full transition-card"
              style={{ width: `${timeline.elapsedPct}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Blocker Banner (v1.3) ─────────────────────────────────────────────────────

interface BlockerBannerProps {
  blockedCount: number;
  blockedIssues: IssueSummary[];
  showBlockedOnly: boolean;
  onToggleBlockedFilter: () => void;
}

function BlockerBanner({
  blockedCount,
  blockedIssues,
  showBlockedOnly,
  onToggleBlockedFilter,
}: BlockerBannerProps) {
  if (blockedCount === 0) return null;

  // Up to 5 keys with links
  const preview = blockedIssues.slice(0, 5);

  return (
    <Alert
      className="mb-4 border-warning-border bg-warning-bg text-warning-foreground"
      role="alert"
    >
      <AlertTriangle className="h-4 w-4 text-warning" aria-hidden="true" />
      <AlertTitle className="text-warning-foreground font-semibold">
        ⚠ {blockedCount} blocked —{" "}
        {preview.map((issue, i) => (
          <span key={issue.key}>
            {i > 0 && ", "}
            <a
              href={issue.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono underline hover:no-underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm"
              aria-label={`Open blocked issue ${issue.key} in Jira`}
            >
              {issue.key}
            </a>
          </span>
        ))}
        {blockedIssues.length > 5 && ` +${blockedIssues.length - 5} more`}
      </AlertTitle>
      <AlertDescription>
        <Button
          type="button"
          size="sm"
          variant={showBlockedOnly ? "default" : "outline"}
          onClick={onToggleBlockedFilter}
          className={cn(
            "mt-1.5 h-7 text-xs",
            showBlockedOnly
              ? "bg-warning text-warning-foreground hover:bg-warning/90 border-warning"
              : "border-warning-border text-warning-foreground hover:bg-warning-bg"
          )}
          // a11y: aria-pressed signals toggle state
          aria-pressed={showBlockedOnly}
        >
          {showBlockedOnly ? "Show all issues" : "Show blocked"}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

// ── Sprint header (v1.3: 3 zones; v1.4: future badge + New Sprint button slot) ─

interface SprintHeaderProps {
  data: GetActiveSprintOutput;
  onSelectSprint?: (id: number) => void;
  assignees: string[];
  hasUnassigned: boolean;
  assigneeFilter: string | null;
  onAssigneeFilterChange: (assignee: string | null) => void;
  filteredTotal: number;
  unfilteredTotal: number;
  /** v1.16: sum of story points across the filtered issues */
  filteredPoints: number;
  /** v1.4: "New Sprint" button rendered by Dashboard into the controls zone */
  createSprintButton?: React.ReactNode;
}

function SprintHeader({
  data,
  onSelectSprint,
  assignees,
  hasUnassigned,
  assigneeFilter,
  onAssigneeFilterChange,
  filteredTotal,
  unfilteredTotal,
  filteredPoints,
  createSprintButton,
}: SprintHeaderProps) {
  const { sprint, activeSprints, futureSprints } = data;

  const formatDate = (d: string | null): string => {
    if (!d) return "—";
    try {
      return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    } catch {
      return d.slice(0, 10);
    }
  };

  // v1.4: is the selected sprint a future sprint?
  const isFutureSprint = sprint.state === "future";

  return (
    <header className="bg-card border border-border rounded-lg p-4 mb-4 shadow-sm">
      {/* ── Zone 1: Identity ────────────────────────────────────────────── */}
      <div className="mb-3">
        {/* Sprint name row — dominant text-2xl + optional "Future sprint" badge */}
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <h2 className="text-2xl font-semibold text-foreground leading-tight">
            {sprint.name}
          </h2>
          {/* v1.4: "Future sprint" badge when sprint.state === "future" */}
          {isFutureSprint && (
            <Badge
              variant="outline"
              className="text-[0.625rem] px-1.5 py-0.5 h-5 border-[hsl(var(--status-codereview-border))] text-[hsl(var(--status-codereview-text))] bg-[hsl(var(--status-codereview-bg))] font-semibold"
              aria-label="Future sprint"
            >
              Future sprint
            </Badge>
          )}
        </div>
        {/* Date range with Calendar icon */}
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
          <Calendar className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
          <span>{formatDate(sprint.startDate)} – {formatDate(sprint.endDate)}</span>
        </p>
        {/* Sprint goal — labeled with Target icon */}
        {sprint.goal && (
          <p
            className="flex items-start gap-1.5 text-sm text-foreground font-medium pl-0 leading-snug"
            aria-label="Sprint goal"
          >
            <Target className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 text-primary" aria-hidden="true" />
            <span>{sprint.goal}</span>
          </p>
        )}
      </div>

      {/* ── Zone 2: Progress ────────────────────────────────────────────── */}
      <SprintProgress data={data} />

      {/* ── Zone 3: Controls ────────────────────────────────────────────── */}
      <div className="flex items-end flex-wrap gap-3 mt-3 pt-3 border-t border-border">
        {/* v1.4: Sprint selector — shown when active + future combined > 1 */}
        {onSelectSprint && (activeSprints.length + futureSprints.length) > 1 && (
          <SprintSelector
            activeSprints={activeSprints}
            futureSprints={futureSprints}
            currentSprintId={sprint.id}
            onSelectSprint={onSelectSprint}
          />
        )}

        {/* v1.4: "New Sprint" button slot — provided by Dashboard */}
        {createSprintButton}

        {/* Assignee filter */}
        <AssigneeFilter
          assignees={assignees}
          hasUnassigned={hasUnassigned}
          activeFilter={assigneeFilter}
          onFilterChange={onAssigneeFilterChange}
        />

        {/* "Showing X of Y issues" — shown when any filter active */}
        {assigneeFilter !== null && (
          <span
            className="text-xs text-primary font-medium whitespace-nowrap self-end mb-2"
            // a11y: aria-live="polite" so screen readers announce the filter result
            aria-live="polite"
          >
            Showing {filteredTotal} of {unfilteredTotal} issues ·{" "}
            <span className="font-semibold text-foreground tabular-nums">{formatPoints(filteredPoints)} pts</span>
          </span>
        )}
      </div>
    </header>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function deriveAssignees(data: GetActiveSprintOutput): {
  assignees: string[];
  hasUnassigned: boolean;
} {
  const seen = new Set<string>();
  let hasUnassigned = false;
  const allIssues = [
    ...data.issuesByStatus.todo,
    ...data.issuesByStatus.inprogress,
    ...data.issuesByStatus.codereview,
    ...data.issuesByStatus.done,
  ];
  for (const issue of allIssues) {
    if (issue.assignee === null) hasUnassigned = true;
    else seen.add(issue.assignee);
  }
  return { assignees: [...seen].sort((a, b) => a.localeCompare(b)), hasUnassigned };
}

function applyFilter(issues: IssueSummary[], filter: string | null): IssueSummary[] {
  if (filter === null) return issues;
  if (filter === "__unassigned__") return issues.filter((i) => i.assignee === null);
  return issues.filter((i) => i.assignee === filter);
}

/**
 * Derive all blocked issues across all four buckets.
 * Used for the blocker banner.
 */
function deriveBlockedIssues(data: GetActiveSprintOutput): IssueSummary[] {
  return [
    ...data.issuesByStatus.todo,
    ...data.issuesByStatus.inprogress,
    ...data.issuesByStatus.codereview,
    ...data.issuesByStatus.done,
  ].filter((i) => i.blocked);
}

// ── Main component ────────────────────────────────────────────────────────────

export function SprintBoard({
  data,
  loading,
  error,
  onRefresh,
  onSelectSprint,
  assigneeFilter = null,
  onAssigneeFilterChange,
  createSprintButton,
  prsByKey,
}: SprintBoardProps) {
  // v1.3: "Show blocked" toggle state — composes with assignee filter
  const [showBlockedOnly, setShowBlockedOnly] = useState(false);

  // Reset "show blocked" when the sprint changes (data changes)
  useEffect(() => {
    setShowBlockedOnly(false);
  }, [data?.sprint?.id]);

  if (loading) return <SprintSkeleton />;

  if (error) {
    const isBridgeDown = error.code === "BRIDGE_DOWN";
    return (
      <Alert variant="destructive" role="alert">
        <AlertTitle>
          {isBridgeDown ? "Sprint bridge is offline" : `Error: ${error.code}`}
        </AlertTitle>
        <AlertDescription>
          <p>{error.message}</p>
          {isBridgeDown && (
            <code className="block font-mono bg-background border border-destructive/30 rounded px-2 py-1 mt-2 text-[0.8125rem] w-fit">
              npm run dev:jira:http
            </code>
          )}
          <Button
            variant="destructive"
            size="sm"
            className="mt-2.5"
            onClick={onRefresh}
            type="button"
          >
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (!data) {
    return (
      <div className="py-10 text-center text-muted-foreground">
        <p className="text-base font-semibold text-foreground mb-1">No sprint data</p>
        <p className="text-sm">
          Start the Jira bridge and click{" "}
          <button
            type="button"
            onClick={onRefresh}
            className="text-primary bg-transparent border-none cursor-pointer underline font-[inherit] hover:text-primary/80 transition-colors"
          >
            refresh
          </button>
          .
        </p>
      </div>
    );
  }

  const { issuesByStatus, totals } = data;

  const hasAnyIssues =
    issuesByStatus.todo.length +
    issuesByStatus.inprogress.length +
    issuesByStatus.codereview.length +
    issuesByStatus.done.length > 0;

  // v1.4: determine if selected sprint is future (for empty-state messaging)
  const isFutureSprint = data.sprint.state === "future";

  if (!hasAnyIssues) {
    return (
      <>
        <SprintHeader
          data={data}
          onSelectSprint={onSelectSprint}
          assignees={[]}
          hasUnassigned={false}
          assigneeFilter={null}
          onAssigneeFilterChange={onAssigneeFilterChange ?? (() => undefined)}
          filteredTotal={0}
          unfilteredTotal={0}
          filteredPoints={0}
          createSprintButton={createSprintButton}
        />
        <div className="py-10 text-center text-muted-foreground">
          {isFutureSprint ? (
            // v1.4: friendly planning note for empty future sprint
            <>
              <p className="text-base font-semibold text-foreground mb-1">
                This sprint is being planned — no issues yet
              </p>
              <p className="text-sm">
                Add issues to this sprint in Jira to prepare your team's upcoming work.
              </p>
            </>
          ) : (
            <>
              <p className="text-base font-semibold text-foreground mb-1">No active sprint issues</p>
              <p className="text-sm">
                The sprint board is empty. Add issues to the active sprint in Jira to see them here.
              </p>
            </>
          )}
        </div>
      </>
    );
  }

  const { assignees, hasUnassigned } = deriveAssignees(data);
  const blockedIssues = deriveBlockedIssues(data);

  // v1.3: compose "show blocked" with the assignee filter
  // "show blocked" acts as an additional filter layer
  const effectiveFilter = assigneeFilter;

  const filterIssues = (issues: IssueSummary[]): IssueSummary[] => {
    let result = applyFilter(issues, effectiveFilter);
    if (showBlockedOnly) result = result.filter((i) => i.blocked);
    return result;
  };

  const filteredTodo       = filterIssues(issuesByStatus.todo);
  const filteredInProgress = filterIssues(issuesByStatus.inprogress);
  const filteredCodeReview = filterIssues(issuesByStatus.codereview);
  const filteredDone       = filterIssues(issuesByStatus.done);

  const filteredTotal    = filteredTodo.length + filteredInProgress.length + filteredCodeReview.length + filteredDone.length;
  // v1.16: sum story points across the filtered issues (points "by filter")
  const filteredPoints   = [filteredTodo, filteredInProgress, filteredCodeReview, filteredDone]
    .flat()
    .reduce((sum, i) => sum + (i.storyPoints ?? 0), 0);
  const unfilteredTotal  = issuesByStatus.todo.length + issuesByStatus.inprogress.length + issuesByStatus.codereview.length + issuesByStatus.done.length;

  // When showBlockedOnly is active, the "showing X of Y" line should appear
  // treat it as an active filter from the UI's perspective
  const isAnyFilterActive = assigneeFilter !== null || showBlockedOnly;
  const showingTotal       = filteredTotal;

  return (
    <div>
      <SprintHeader
        data={data}
        onSelectSprint={onSelectSprint}
        assignees={assignees}
        hasUnassigned={hasUnassigned}
        assigneeFilter={assigneeFilter}
        onAssigneeFilterChange={(newFilter) => {
          // Changing assignee filter clears the showBlockedOnly secondary toggle
          // (they compose: both can be active at once, but assignee reset = user intent to reset)
          onAssigneeFilterChange?.(newFilter);
        }}
        filteredTotal={isAnyFilterActive ? showingTotal : unfilteredTotal}
        unfilteredTotal={unfilteredTotal}
        filteredPoints={filteredPoints}
        createSprintButton={createSprintButton}
      />

      {/* v1.3: Blocker banner — hidden when 0 blocked */}
      <BlockerBanner
        blockedCount={totals.blocked}
        blockedIssues={blockedIssues}
        showBlockedOnly={showBlockedOnly}
        onToggleBlockedFilter={() => setShowBlockedOnly((v) => !v)}
      />

      {/* perf: 4-column grid; overflow-x-auto for 360px */}
      <div className="overflow-x-auto">
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 min-w-0">
          <SprintColumn colorKey="todo"       issues={filteredTodo}       prsByKey={prsByKey} />
          <SprintColumn colorKey="inprogress" issues={filteredInProgress} prsByKey={prsByKey} />
          <SprintColumn colorKey="codereview" issues={filteredCodeReview} prsByKey={prsByKey} />
          <SprintColumn colorKey="done"       issues={filteredDone}       prsByKey={prsByKey} />
        </div>
      </div>
    </div>
  );
}
