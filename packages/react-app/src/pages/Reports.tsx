// Reports page — CONTRACTS.md §6, ADR-012 (Phase 3), ADR-013 (v1.4.1), ADR-016 (v1.5)
//
// v1.5 layout (ADR-016 — supersedes v1.4.1 single-column):
//   Full-width responsive dashboard grid — NOT a narrow single column, NOT the old flex-row.
//   Wide (≥ lg): two-column rows; collapses to single-column at ≤ md.
//   Grid anatomy:
//     Row 0 (full-width): Sprint picker + export bar card
//     Row 1 (2 cols): Completion summary + Velocity
//     Row 2 (2 cols): By-assignee table + [FRONTEND-2 SLOT: Leaves / team calendar]
//     Row 3 (full-width): Completed issues | Carryover issues (split at ≥ lg)
//     Row 4 (full-width): AI executive summary
//
//   Story-points focus: completed pts, committed pts, completion rate bar,
//   carryover pts. No "issues done/total" metric tile. By-assignee: name,
//   done pts, total pts only (no issue counts). Blocked is an optional risk chip.
//   All point values via formatPoints (≤2 decimals, trailing zeros trimmed).
//
//   v1.5 velocity context (ADR-015): useVelocity receives selectedSprintId as
//   beforeSprintId — chart shows "the N sprints before this sprint"; refetches on change.
//
//   v1.5 DoD (ADR-014): completedPoints already includes code-review (§4.12 backend).
//
// a11y: semantic headings, role="progressbar", aria-live regions, labeled controls.
// perf: velocity + report load in parallel; AI summary is on-demand only.

import React, { useState, useEffect, useRef } from "react";
import {
  FileText,
  Download,
  Copy,
  Printer,
  TrendingUp,
  AlertCircle,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Users,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import { useSprintList, useSprintReport, useVelocity } from "../hooks/useJira";
import { getAiStatus, aiSprintSummary } from "../lib/aiClient";
import { useBoards } from "../lib/boards";
import { buildReportMarkdown, buildReportCsv } from "../lib/reportMarkdown";
import { formatPoints } from "../lib/format";
import { computeCapacity, possibleCommittedVelocity, sprintWorkingDays } from "../lib/capacity";
import { LeavesCalendarCard } from "../components/LeavesCalendarCard";
import type {
  SprintRef,
  SprintReport,
  VelocityData,
  SprintSummaryRequest,
  AiStatus,
  BoardKey,
  SharedSprintProps,
} from "../lib/types";
import type { McpError } from "../lib/mcpClient";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// ── State badge ───────────────────────────────────────────────────────────────

function StateBadge({ state }: { state: string }) {
  if (state === "active") {
    return (
      <Badge className="bg-[hsl(var(--status-inprogress-bg))] text-[hsl(var(--status-inprogress-text))] border border-[hsl(var(--status-inprogress-border))] hover:bg-[hsl(var(--status-inprogress-bg))]">
        Active
      </Badge>
    );
  }
  if (state === "closed") {
    return (
      <Badge className="bg-[hsl(var(--status-done-bg))] text-[hsl(var(--status-done-text))] border border-[hsl(var(--status-done-border))] hover:bg-[hsl(var(--status-done-bg))]">
        Closed
      </Badge>
    );
  }
  return (
    <Badge className="bg-[hsl(var(--status-todo-bg))] text-[hsl(var(--status-todo-text))] border border-[hsl(var(--status-todo-border))] hover:bg-[hsl(var(--status-todo-bg))]">
      {state}
    </Badge>
  );
}

// ── Sprint picker ─────────────────────────────────────────────────────────────

interface SprintPickerProps {
  closed: SprintRef[];
  active: SprintRef[];
  selectedId: number | null;
  onChange: (id: number) => void;
}

function SprintPicker({ closed, active, selectedId, onChange }: SprintPickerProps) {
  // a11y: native <select> with descriptive label
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor="sprint-picker"
        className="text-xs font-medium text-muted-foreground uppercase tracking-wide"
      >
        Sprint
      </label>
      <select
        id="sprint-picker"
        value={selectedId ?? ""}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring transition-card min-w-[200px]"
        aria-label="Select sprint to view report"
      >
        {active.length > 0 && (
          <optgroup label="Active">
            {active.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </optgroup>
        )}
        {closed.length > 0 && (
          <optgroup label="Closed">
            {closed.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </div>
  );
}

// ── Loading skeleton for report ───────────────────────────────────────────────

function ReportSkeleton() {
  return (
    // a11y: aria-busy region
    <div aria-busy="true" aria-label="Loading sprint report" className="space-y-4">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-20 w-full rounded-lg" />
      <Skeleton className="h-24 w-full rounded-lg" />
      <Skeleton className="h-32 w-full rounded-lg" />
    </div>
  );
}

// ── Bridge-down error ─────────────────────────────────────────────────────────

function BridgeDownAlert({
  error,
  onRetry,
}: {
  error: McpError;
  onRetry: () => void;
}) {
  const isBridgeDown = error.code === "BRIDGE_DOWN";
  return (
    <Alert variant="destructive" role="alert">
      <AlertCircle className="h-4 w-4" aria-hidden="true" />
      <AlertTitle>{isBridgeDown ? "Jira bridge is offline" : `Error: ${error.code}`}</AlertTitle>
      <AlertDescription>
        <p>{error.message}</p>
        {isBridgeDown && (
          <code className="block font-mono bg-background border border-destructive/30 rounded px-2 py-1 mt-2 text-[0.8125rem] w-fit">
            npm run dev:jira:http
          </code>
        )}
        <Button variant="destructive" size="sm" className="mt-2.5" onClick={onRetry} type="button">
          Retry
        </Button>
      </AlertDescription>
    </Alert>
  );
}

// ── Completion summary card ───────────────────────────────────────────────────
//
// v1.4.1 (ADR-013): story-points focus.
//   Metrics: committed pts, completed pts, completion rate (progress bar),
//   carryover pts (= committed − completed).
//   Blocked shown as an optional small risk chip, NOT a headline metric.
//   "Issues done / total" tile is removed.
//   v1.5 (ADR-014): completedPoints already includes code-review (backend).

interface CompletionSummaryCardProps {
  report: SprintReport;
}

function CompletionSummaryCard({ report }: CompletionSummaryCardProps) {
  const ratePct = Math.round(report.completionRate * 100);
  // perf: pure derivation — no state needed
  const carryoverPoints = report.committedPoints - report.completedPoints;

  return (
    <Card className="shadow-sm h-full">
      <CardHeader className="pb-2">
        <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-[hsl(var(--status-done))]" aria-hidden="true" />
          Completion Summary
        </h3>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Progress bar — completion rate by points */}
        <div>
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>
              {formatPoints(report.completedPoints)} / {formatPoints(report.committedPoints)} pts
            </span>
            <span>{ratePct}%</span>
          </div>
          {/* a11y: role="progressbar" with aria-valuenow */}
          <div
            role="progressbar"
            aria-valuenow={ratePct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Sprint completion: ${ratePct}%`}
            className="h-2 rounded-full bg-muted overflow-hidden"
          >
            <div
              className="h-full bg-[hsl(var(--status-done))] rounded-full transition-all"
              style={{ width: `${Math.min(ratePct, 100)}%` }}
            />
          </div>
        </div>

        {/* Stats grid — 3 tiles: committed, completed, carryover pts */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-lg bg-muted p-3 text-center">
            <p className="text-xs text-muted-foreground mb-0.5">Committed</p>
            <p className="text-lg font-bold text-foreground tabular-nums">
              {formatPoints(report.committedPoints)}
            </p>
            <p className="text-[0.6875rem] text-muted-foreground">pts</p>
          </div>
          <div className="rounded-lg bg-[hsl(var(--status-done-bg))] p-3 text-center">
            <p className="text-xs text-muted-foreground mb-0.5">Completed</p>
            <p className="text-lg font-bold text-[hsl(var(--status-done-text))] tabular-nums">
              {formatPoints(report.completedPoints)}
            </p>
            <p className="text-[0.6875rem] text-muted-foreground">pts</p>
          </div>
          <div
            className={`rounded-lg p-3 text-center ${
              carryoverPoints > 0
                ? "bg-[hsl(var(--warning-bg))]"
                : "bg-muted"
            }`}
          >
            <p className="text-xs text-muted-foreground mb-0.5">Carryover</p>
            <p
              className={`text-lg font-bold tabular-nums ${
                carryoverPoints > 0
                  ? "text-[hsl(var(--warning-foreground))]"
                  : "text-foreground"
              }`}
            >
              {formatPoints(carryoverPoints)}
            </p>
            <p className="text-[0.6875rem] text-muted-foreground">pts</p>
          </div>
        </div>

        {/* Blocked risk chip — optional impediment signal, not a metric (ADR-013) */}
        {report.blockedCount > 0 && (
          <div className="flex items-center gap-2 pt-1">
            <AlertTriangle className="h-3.5 w-3.5 text-warning flex-shrink-0" aria-hidden="true" />
            <span className="text-xs text-muted-foreground">
              <span className="font-semibold text-warning-foreground">{report.blockedCount}</span>
              {" "}blocked issue{report.blockedCount !== 1 ? "s" : ""} — impediment risk
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── By assignee table ─────────────────────────────────────────────────────────
//
// v1.4.1 (ADR-013): points only — name, done pts, total pts.
// v1.5 (ADR-016): added Leaves column (days off this sprint from get_leaves data).

interface ByAssigneeTableProps {
  byAssignee: SprintReport["byAssignee"];
  /** v1.5: per-assignee working leave days (assigneeName → daysOff) */
  leaves?: Record<string, number>;
}

function ByAssigneeTable({ byAssignee, leaves }: ByAssigneeTableProps) {
  const hasLeaves = leaves !== undefined;

  if (byAssignee.length === 0) {
    return (
      <Card className="shadow-sm h-full">
        <CardHeader className="pb-2">
          <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" aria-hidden="true" />
            By Assignee
          </h3>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No assignee data.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-sm h-full">
      <CardHeader className="pb-2">
        <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" aria-hidden="true" />
          By Assignee
        </h3>
      </CardHeader>
      <CardContent>
        {/* a11y: data table with headers */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="Sprint results by assignee">
            <thead>
              <tr className="border-b border-border text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <th className="text-left pb-2 pr-4">Name</th>
                <th className="text-right pb-2 px-3">Done pts</th>
                <th className="text-right pb-2 pl-3">Total pts</th>
                {/* v1.5 Leaves column (ADR-016) */}
                {hasLeaves && (
                  <th className="text-right pb-2 pl-3">Leaves</th>
                )}
              </tr>
            </thead>
            <tbody>
              {byAssignee.map((row) => (
                <tr key={row.name} className="border-b border-border/50 hover:bg-muted/30 transition-card">
                  <td className="py-2 pr-4 font-medium text-foreground">{row.name}</td>
                  <td className="py-2 px-3 text-right text-[hsl(var(--status-done-text))] tabular-nums">
                    {formatPoints(row.donePoints)}
                  </td>
                  <td className="py-2 pl-3 text-right text-muted-foreground tabular-nums">
                    {formatPoints(row.totalPoints)}
                  </td>
                  {/* v1.5: Leaves column — days off this sprint (ADR-016) */}
                  {hasLeaves && (
                    <td className="py-2 pl-3 text-right tabular-nums text-muted-foreground">
                      {(leaves?.[row.name] ?? 0) > 0 ? (
                        <span className="text-[hsl(var(--warning-foreground))] font-medium">
                          {leaves?.[row.name]} day{leaves?.[row.name] !== 1 ? "s" : ""}
                        </span>
                      ) : (
                        <span>—</span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Issue list ────────────────────────────────────────────────────────────────

interface IssueListProps {
  title: string;
  issues: SprintReport["completed"] | SprintReport["notCompleted"];
  emptyText: string;
  variant?: "completed" | "carryover";
}

function IssueList({ title, issues, emptyText, variant = "completed" }: IssueListProps) {
  const isCarryover = variant === "carryover";
  return (
    <Card className="shadow-sm h-full">
      <CardHeader className="pb-2">
        <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
          {isCarryover ? (
            <AlertTriangle className="h-4 w-4 text-warning" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-[hsl(var(--status-done))]" aria-hidden="true" />
          )}
          {title}
          <span className="ml-auto text-xs font-normal text-muted-foreground">
            {issues.length} issue{issues.length !== 1 ? "s" : ""}
          </span>
        </h3>
      </CardHeader>
      <CardContent>
        {issues.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">{emptyText}</p>
        ) : (
          // a11y: list of issues
          <ul className="space-y-2" style={{ listStyle: "none" }}>
            {issues.map((issue) => (
              <li
                key={issue.key}
                className="flex items-start gap-3 py-1.5 border-b border-border/40 last:border-0"
              >
                {/* Key → Jira link */}
                {/* a11y: descriptive aria-label on the link */}
                <a
                  href={issue.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs font-bold text-primary hover:underline flex-shrink-0 mt-0.5 w-[72px] truncate focus:outline-none focus:ring-2 focus:ring-ring rounded"
                  aria-label={`Open ${issue.key} in Jira`}
                >
                  {issue.key}
                </a>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground break-words">{issue.summary}</p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    {issue.assignee && (
                      <span className="text-[0.6875rem] text-muted-foreground">
                        {issue.assignee}
                      </span>
                    )}
                    {issue.storyPoints !== null && (
                      <span className="text-[0.6875rem] text-muted-foreground tabular-nums">
                        {formatPoints(issue.storyPoints)} pts
                      </span>
                    )}
                    {issue.blocked && (
                      <Badge className="text-[0.625rem] px-1.5 py-0 bg-[hsl(var(--status-blocked-bg))] text-[hsl(var(--status-blocked-text))] border border-[hsl(var(--status-blocked-border))] hover:bg-[hsl(var(--status-blocked-bg))]">
                        ⚠ Blocked
                      </Badge>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ── Velocity chart (dependency-free CSS bars) ─────────────────────────────────
//
// perf: bars are pure CSS — no canvas/SVG library; renders instantly.
// Each sprint = two bars: committed (grey) vs completed (green).
// Bar heights are proportional to the max committed points across all sprints.
// v1.4.1: all point values formatted via formatPoints.
// v1.5 (ADR-015): chart is for the N sprints BEFORE the selected sprint.
//   Label says "the N sprints before this sprint" when a beforeSprintId is active.

// ── Possible committed velocity panel (v1.5, ADR-016) ─────────────────────────
//
// Pure display: shows the capacity-adjusted velocity heuristic.
// Inputs displayed: "N people · W working days · L leave days → X% capacity".
// Labeled a heuristic per ADR-016/010/012 — not a commitment.

interface PossibleVelocityPanelProps {
  averageCompleted: number;
  assigneeCount: number;
  workingDayCount: number;
  leavePersonDays: number;
  capacityFactor: number;
  possibleVelocity: number;
  hasVelocityBaseline: boolean; // false when no prior sprints
}

function PossibleVelocityPanel({
  averageCompleted,
  assigneeCount,
  workingDayCount,
  leavePersonDays,
  capacityFactor,
  possibleVelocity,
  hasVelocityBaseline,
}: PossibleVelocityPanelProps) {
  const capacityPct = Math.round(capacityFactor * 100);

  return (
    <div className="mt-4 rounded-lg border border-[hsl(var(--info-border))] bg-[hsl(var(--info-bg))] px-4 py-3 text-sm">
      {/* Title */}
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
        Possible committed velocity
        <span className="ml-1 font-normal normal-case text-muted-foreground">
          — heuristic, not a commitment
        </span>
      </p>

      {/* Capacity inputs row */}
      <p className="text-xs text-muted-foreground mb-2">
        <span className="font-medium text-foreground">{assigneeCount}</span> people ·{" "}
        <span className="font-medium text-foreground">{workingDayCount}</span> working day
        {workingDayCount !== 1 ? "s" : ""} ·{" "}
        <span className="font-medium text-[hsl(var(--warning-foreground))]">
          {leavePersonDays}
        </span>{" "}
        leave day{leavePersonDays !== 1 ? "s" : ""} →{" "}
        <span className="font-semibold text-[hsl(var(--info))]">{capacityPct}%</span> capacity
      </p>

      {/* Result */}
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
          {" "}— baseline unavailable (no prior sprints). Velocity data will appear after the first sprint completes.
        </p>
      )}

      {/* Long-form label */}
      <p className="mt-2 text-[0.6875rem] text-muted-foreground leading-snug">
        Possible committed velocity for this sprint — adjusts the average for entered leaves,
        not a commitment.
      </p>
    </div>
  );
}

interface VelocityChartProps {
  velocity: VelocityData;
  /** v1.5: true when velocity was fetched with a specific beforeSprintId */
  hasSprintContext?: boolean;
  /** v1.5 (ADR-016): capacity panel inputs */
  capacityPanel?: {
    averageCompleted: number;
    assigneeCount: number;
    workingDayCount: number;
    leavePersonDays: number;
    capacityFactor: number;
    possibleVelocity: number;
  };
}

function VelocityChart({ velocity, hasSprintContext = false, capacityPanel }: VelocityChartProps) {
  if (velocity.sprints.length === 0) {
    return (
      <Card className="shadow-sm h-full">
        <CardHeader className="pb-2">
          <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" aria-hidden="true" />
            Velocity
          </h3>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground py-2">
            No closed sprints yet. Velocity data appears after the first sprint is completed.
          </p>
          {/* v1.5 (ADR-016): still show capacity factor even without velocity baseline */}
          {capacityPanel && (
            <PossibleVelocityPanel
              averageCompleted={capacityPanel.averageCompleted}
              assigneeCount={capacityPanel.assigneeCount}
              workingDayCount={capacityPanel.workingDayCount}
              leavePersonDays={capacityPanel.leavePersonDays}
              capacityFactor={capacityPanel.capacityFactor}
              possibleVelocity={capacityPanel.possibleVelocity}
              hasVelocityBaseline={false}
            />
          )}
        </CardContent>
      </Card>
    );
  }

  const maxPts = Math.max(
    ...velocity.sprints.map((s) => Math.max(s.committedPoints, s.completedPoints)),
    1 // avoid div/0
  );
  const BAR_MAX_HEIGHT = 96; // px — chart height

  // v1.5 (ADR-015): label reflects the selected-sprint context
  const caveatText = hasSprintContext
    ? `Suggested capacity = avg of the ${velocity.sprintCount} sprint(s) before this sprint — not a commitment.`
    : `Suggested capacity = avg of last ${velocity.sprintCount} completed sprint(s) — not a commitment.`;

  return (
    <Card className="shadow-sm h-full">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" aria-hidden="true" />
            Velocity
          </h3>
          {/* Legend */}
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-sm bg-muted border border-border" aria-hidden="true" />
              Committed
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-sm bg-[hsl(var(--status-done))]" aria-hidden="true" />
              Completed
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* a11y: chart described as a figure with a caption */}
        <figure aria-label="Velocity bar chart — committed vs completed points per sprint">
          {/* Bar chart */}
          <div
            className="flex items-end gap-2 overflow-x-auto pb-2"
            style={{ minHeight: `${BAR_MAX_HEIGHT + 32}px` }}
            role="img"
            aria-label="Bar chart"
          >
            {velocity.sprints.map((sprint) => {
              const committedH = Math.max(
                Math.round((sprint.committedPoints / maxPts) * BAR_MAX_HEIGHT),
                2
              );
              const completedH = Math.max(
                Math.round((sprint.completedPoints / maxPts) * BAR_MAX_HEIGHT),
                2
              );
              return (
                <div
                  key={sprint.id}
                  className="flex flex-col items-center gap-1 flex-shrink-0"
                  style={{ minWidth: "48px" }}
                  aria-label={`${sprint.name}: committed ${formatPoints(sprint.committedPoints)} pts, completed ${formatPoints(sprint.completedPoints)} pts`}
                >
                  {/* Two bars side-by-side */}
                  <div className="flex items-end gap-0.5" style={{ height: `${BAR_MAX_HEIGHT}px` }}>
                    {/* Committed bar */}
                    <div
                      className="w-5 rounded-t bg-muted border border-border transition-all"
                      style={{ height: `${committedH}px` }}
                      title={`Committed: ${formatPoints(sprint.committedPoints)} pts`}
                    />
                    {/* Completed bar */}
                    <div
                      className="w-5 rounded-t bg-[hsl(var(--status-done))] transition-all"
                      style={{ height: `${completedH}px` }}
                      title={`Completed: ${formatPoints(sprint.completedPoints)} pts`}
                    />
                  </div>
                  {/* Sprint name label */}
                  <p
                    className="text-[0.6rem] text-muted-foreground text-center leading-tight max-w-[48px] truncate"
                    title={sprint.name}
                  >
                    {sprint.name}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Stats row */}
          <div className="mt-4 flex flex-col sm:flex-row gap-3 text-sm">
            <div className="flex-1 rounded-lg bg-muted p-3 text-center">
              <p className="text-xs text-muted-foreground mb-0.5">Avg completed</p>
              <p className="text-xl font-bold text-foreground tabular-nums">
                {formatPoints(velocity.averageCompleted)}
              </p>
              <p className="text-[0.6875rem] text-muted-foreground">pts / sprint</p>
            </div>
            <div className="flex-1 rounded-lg bg-[hsl(var(--info-bg))] border border-[hsl(var(--info-border))] p-3 text-center">
              <p className="text-xs text-muted-foreground mb-0.5">Suggested capacity</p>
              <p className="text-xl font-bold text-[hsl(var(--info))] tabular-nums">
                {formatPoints(velocity.forecastNext)}
              </p>
              <p className="text-[0.6875rem] text-muted-foreground">pts — next sprint</p>
            </div>
          </div>
          {/* Heuristic caveat — per ADR-010/012/015: must be clearly labeled */}
          <figcaption className="mt-2 text-[0.6875rem] text-muted-foreground">
            {caveatText}
          </figcaption>

          {/* v1.5 (ADR-016): possible committed velocity panel */}
          {capacityPanel && (
            <PossibleVelocityPanel
              averageCompleted={capacityPanel.averageCompleted}
              assigneeCount={capacityPanel.assigneeCount}
              workingDayCount={capacityPanel.workingDayCount}
              leavePersonDays={capacityPanel.leavePersonDays}
              capacityFactor={capacityPanel.capacityFactor}
              possibleVelocity={capacityPanel.possibleVelocity}
              hasVelocityBaseline={velocity.sprints.length > 0}
            />
          )}
        </figure>
      </CardContent>
    </Card>
  );
}

// ── Velocity loading skeleton ─────────────────────────────────────────────────

function VelocitySkeleton() {
  return (
    <Card className="shadow-sm h-full">
      <CardHeader className="pb-2">
        <Skeleton className="h-5 w-24" />
      </CardHeader>
      <CardContent>
        <div className="flex items-end gap-2 h-24">
          {[60, 80, 48, 96, 72, 64].map((h, i) => (
            <Skeleton key={i} className="w-10 rounded-t" style={{ height: `${h}px` }} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Tiny inline markdown renderer ─────────────────────────────────────────────
//
// perf: no library — handles headings (## / ###), bold (**), bullet (-)
// and bare paragraphs only. Good enough for the AI summary format.

function renderAiMarkdown(md: string): React.ReactNode {
  const paragraphs = md.split(/\n{2,}/);
  return (
    <div className="space-y-3">
      {paragraphs.map((para, pi) => {
        const lines = para.split("\n").filter(Boolean);
        if (lines.length === 0) return null;

        // Check if this paragraph is a heading
        const firstLine = lines[0];
        if (firstLine.startsWith("### ")) {
          return (
            <h5 key={pi} className="text-sm font-semibold text-foreground mt-2">
              {firstLine.slice(4)}
            </h5>
          );
        }
        if (firstLine.startsWith("## ")) {
          return (
            <h4 key={pi} className="text-sm font-bold text-foreground mt-3">
              {firstLine.slice(3)}
            </h4>
          );
        }

        // Check if paragraph is a bullet list
        if (lines.every((l) => l.startsWith("- ") || l.startsWith("* "))) {
          return (
            <ul key={pi} className="list-disc pl-5 space-y-1">
              {lines.map((l, li) => (
                <li key={li} className="text-sm text-foreground leading-relaxed">
                  {renderInline(l.slice(2))}
                </li>
              ))}
            </ul>
          );
        }

        // Default: paragraph
        return (
          <p key={pi} className="text-sm text-foreground leading-relaxed">
            {lines.map((l, li) => (
              <React.Fragment key={li}>
                {li > 0 && <br />}
                {renderInline(l)}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

// Inline: bold (**text**) only
function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

// ── AI summary section ────────────────────────────────────────────────────────

interface AiSummaryProps {
  report: SprintReport;
  aiStatus: AiStatus;
  aiSummary: string | null;
  aiLoading: boolean;
  aiError: McpError | null;
  onDraft: () => void;
}

function AiSummarySection({
  report: _report,
  aiStatus,
  aiSummary,
  aiLoading,
  aiError,
  onDraft,
}: AiSummaryProps) {
  // When AI is disabled
  if (!aiStatus.enabled) {
    return (
      <Card className="shadow-sm opacity-70">
        <CardHeader className="pb-2">
          <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            AI Executive Summary
          </h3>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            AI summary unavailable — set AI_PROVIDER in .env to enable (see docs/SETUP.md).
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
            AI Executive Summary
          </h3>
          {!aiSummary && !aiLoading && (
            <Button
              size="sm"
              variant="outline"
              onClick={onDraft}
              disabled={aiLoading}
              type="button"
              aria-label="Draft AI executive summary for this sprint"
            >
              <Sparkles className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
              Draft summary
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {aiLoading && (
          <div aria-busy="true" aria-label="Drafting AI summary" className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        )}

        {/* AI_UNAVAILABLE error — inline, does not break the data report */}
        {!aiLoading && aiError && (
          <div
            // a11y: aria-live so screen readers announce the inline error
            aria-live="polite"
            className="text-sm text-muted-foreground bg-muted rounded-md px-3 py-2"
          >
            {aiError.code === "AI_UNAVAILABLE"
              ? "AI summary unavailable — set AI_PROVIDER=anthropic or github and the matching key (see docs/SETUP.md)."
              : `AI summary failed: ${aiError.message}`}
          </div>
        )}

        {!aiLoading && !aiError && aiSummary && (
          <div
            // a11y: aria-live for when summary appears after clicking Draft
            aria-live="polite"
            className="prose-sm"
          >
            {renderAiMarkdown(aiSummary)}
          </div>
        )}

        {!aiLoading && !aiError && !aiSummary && (
          <p className="text-sm text-muted-foreground">
            Click "Draft summary" to generate an AI executive summary of this sprint.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Export bar ────────────────────────────────────────────────────────────────

interface ExportBarProps {
  report: SprintReport;
  velocity: VelocityData | null;
  aiSummary: string | null;
  /** v1.5 (ADR-016): leaves & capacity data for the Markdown export */
  leavesCapacity?: import("../lib/reportMarkdown").LeavesCapacityData | null;
}

function ExportBar({ report, velocity, aiSummary, leavesCapacity }: ExportBarProps) {
  const [copied, setCopied] = useState(false);

  function getMarkdown(): string {
    return buildReportMarkdown(report, velocity, aiSummary, leavesCapacity);
  }

  async function handleCopy() {
    const md = getMarkdown();
    try {
      await navigator.clipboard.writeText(md);
    } catch {
      // Fallback for older browsers / insecure contexts
      const el = document.createElement("textarea");
      el.value = md;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.focus();
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function downloadBlob(content: string, mime: string, ext: string) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sprint-report-${slugify(report.sprint.name)}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handleDownload() {
    downloadBlob(getMarkdown(), "text/markdown;charset=utf-8", "md");
  }

  function handleDownloadCsv() {
    downloadBlob(buildReportCsv(report, leavesCapacity), "text/csv;charset=utf-8", "csv");
  }

  function handlePrint() {
    window.print();
  }

  return (
    // a11y: landmark role="toolbar" with label
    <div
      role="toolbar"
      aria-label="Export sprint report"
      className="flex items-center gap-2 flex-wrap print:hidden"
    >
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide mr-1">
        Export
      </span>

      <Button
        variant="outline"
        size="sm"
        onClick={handleCopy}
        type="button"
        aria-label={copied ? "Report markdown copied to clipboard" : "Copy report as Markdown"}
      >
        <Copy className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
        {copied ? "Copied!" : "Copy"}
      </Button>

      <Button
        variant="outline"
        size="sm"
        onClick={handleDownload}
        type="button"
        aria-label="Download report as Markdown file"
      >
        <Download className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
        Download .md
      </Button>

      <Button
        variant="outline"
        size="sm"
        onClick={handleDownloadCsv}
        type="button"
        aria-label="Download report as CSV file"
      >
        <Download className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
        Download .csv
      </Button>

      <Button
        variant="outline"
        size="sm"
        onClick={handlePrint}
        type="button"
        aria-label="Print or save report as PDF"
      >
        <Printer className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
        Print / PDF
      </Button>
    </div>
  );
}

// ── Per-sprint report — full-width dashboard grid (ADR-016) ───────────────────
//
// v1.5 full-width layout. Reading order (screen-reader + logical):
//   1. Sprint header (name, dates, goal, state badge) + export bar
//   ── grid row 1 (lg: 2 cols) ──
//   2. Completion summary (left/top)
//   3. Velocity chart   (right/top)
//   ── grid row 2 (lg: 2 cols) ──
//   4. By-assignee table (left/top)
//   5. FRONTEND-2 SLOT: Leaves / team calendar (right/top) — see insertion comment
//   ── grid row 3 (lg: 2 cols) ──
//   6. Completed issues
//   7. Carryover issues
//   ── full-width ──
//   8. AI executive summary
//
// Responsive: 1 col at ≤ md, 2 cols at ≥ lg.
// Print: full-width single column (grid collapses).

interface SprintReportViewProps {
  report: SprintReport;
  velocity: VelocityData | null;
  velocityLoading: boolean;
  velocityError: McpError | null;
  velocityHasContext: boolean;
  /** v1.5 (ADR-016): selected sprint ID for the leaves calendar */
  selectedSprintId: number;
  /** v1.5 (ADR-016): per-assignee leave days from LeavesCalendarCard */
  byAssigneeLeaveDays: Record<string, number>;
  onLeavesChange: (leaveDays: Record<string, number>) => void;
  aiStatus: AiStatus;
  aiSummary: string | null;
  aiLoading: boolean;
  aiError: McpError | null;
  onDraftAi: () => void;
}

function SprintReportView({
  report,
  velocity,
  velocityLoading,
  velocityError,
  velocityHasContext,
  selectedSprintId,
  byAssigneeLeaveDays,
  onLeavesChange,
  aiStatus,
  aiSummary,
  aiLoading,
  aiError,
  onDraftAi,
}: SprintReportViewProps) {
  // v1.5 (ADR-016): compute capacity from report data + leaves
  const workingDays = sprintWorkingDays(report.sprint.startDate, report.sprint.endDate);
  const assigneeNames = report.byAssignee.map((a) => a.name);

  const capacity = computeCapacity({
    assignees: assigneeNames,
    workingDays,
    leavesByAssignee: Object.fromEntries(
      assigneeNames.map((name) => {
        // Reconstitute dates from counts isn't possible; we pass the raw
        // leaveDays map and capacity gets its own view from the leaves data.
        // The LeavesCalendarCard propagates byAssigneeLeaveDays (counts) up;
        // for the capacity formula we use these counts directly:
        return [name, [] as string[]]; // placeholder — use computeCapacityFromCounts below
      })
    ),
  });
  // perf: compute capacity from count-based data (propagated up from LeavesCalendarCard)
  const leavePersonDays = assigneeNames.reduce(
    (sum, name) => sum + (byAssigneeLeaveDays[name] ?? 0),
    0
  );
  const totalPersonDays = assigneeNames.length * workingDays.length;
  const availablePersonDays = totalPersonDays - leavePersonDays;
  const capacityFactor = totalPersonDays === 0 ? 1 : availablePersonDays / totalPersonDays;

  // Override capacity with count-based computation
  void capacity; // suppress unused warning — we use direct computation above

  const avgCompleted = velocity?.averageCompleted ?? 0;
  const possibleVelocity = possibleCommittedVelocity(avgCompleted, capacityFactor);
  return (
    // a11y: main report region, labeled for screen readers
    <article aria-label={`Sprint report: ${report.sprint.name}`} className="space-y-4">

      {/* ── Sprint header (full-width) ─────────────────────────────────── */}
      <div className="flex flex-col gap-3 print-report-header">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-3 flex-wrap mb-1">
              <h2 className="text-xl font-semibold text-foreground">{report.sprint.name}</h2>
              <StateBadge state={report.sprint.state} />
            </div>
            <p className="text-sm text-muted-foreground">
              {formatDate(report.sprint.startDate)} – {formatDate(report.sprint.endDate)}
            </p>
            {report.sprint.goal && (
              <p className="text-sm text-foreground mt-1 italic">
                Goal: {report.sprint.goal}
              </p>
            )}
          </div>
          {/* Export bar floated right on wide screens */}
          <div className="print:hidden">
            <ExportBar
              report={report}
              velocity={velocity}
              aiSummary={aiSummary}
              leavesCapacity={
                Object.keys(byAssigneeLeaveDays).length > 0 || workingDays.length > 0
                  ? {
                      byAssigneeLeaveDays,
                      leavePersonDays,
                      capacityFactor,
                      possibleCommittedVelocity: possibleVelocity,
                      averageCompleted: avgCompleted,
                      workingDayCount: workingDays.length,
                    }
                  : null
              }
            />
          </div>
        </div>
      </div>

      <Separator />

      {/* ── Row 1: Completion summary + Velocity (lg: 2 cols) ─────────── */}
      {/*
          perf: grid — two equal columns at lg, single column ≤ md.
          Both cards have h-full so they match height in the 2-col layout.
      */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* (2) Completion summary */}
        <CompletionSummaryCard report={report} />

        {/* (3) Velocity */}
        {velocityLoading && <VelocitySkeleton />}
        {!velocityLoading && velocityError && (
          <Card className="shadow-sm h-full">
            <CardHeader className="pb-2">
              <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" aria-hidden="true" />
                Velocity
              </h3>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Could not load velocity data: {velocityError.message}
              </p>
            </CardContent>
          </Card>
        )}
        {!velocityLoading && !velocityError && velocity && (
          <VelocityChart
            velocity={velocity}
            hasSprintContext={velocityHasContext}
            capacityPanel={{
              averageCompleted: avgCompleted,
              assigneeCount: assigneeNames.length,
              workingDayCount: workingDays.length,
              leavePersonDays,
              capacityFactor,
              possibleVelocity,
            }}
          />
        )}
        {!velocityLoading && !velocityError && !velocity && (
          <Card className="shadow-sm h-full">
            <CardHeader className="pb-2">
              <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" aria-hidden="true" />
                Velocity
              </h3>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground py-2">
                No closed sprints yet. Velocity data appears after the first sprint is completed.
              </p>
              {/* v1.5 (ADR-016): show capacity factor even without velocity */}
              <PossibleVelocityPanel
                averageCompleted={avgCompleted}
                assigneeCount={assigneeNames.length}
                workingDayCount={workingDays.length}
                leavePersonDays={leavePersonDays}
                capacityFactor={capacityFactor}
                possibleVelocity={possibleVelocity}
                hasVelocityBaseline={false}
              />
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── Row 2: By-assignee + Leaves calendar (v1.5 ADR-016) ───────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* (4) By assignee — v1.5: passes leaves map for the Leaves column */}
        <ByAssigneeTable
          byAssignee={report.byAssignee}
          leaves={byAssigneeLeaveDays}
        />

        {/* (5) Leaves / team calendar — v1.5 (ADR-016). v1.8.1: editable on Reports too
            (user request) — rostered from this sprint's assignees; persists via set_leaves. */}
        <LeavesCalendarCard
          sprintId={selectedSprintId}
          sprint={report.sprint}
          byAssignee={report.byAssignee}
          onLeavesChange={onLeavesChange}
        />
      </div>

      {/* ── Row 3: Completed issues + Carryover (lg: 2 cols) ─────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* (6) Completed issues */}
        <IssueList
          title="Completed Issues"
          issues={report.completed}
          emptyText="No completed issues this sprint."
          variant="completed"
        />
        {/* (7) Carryover list */}
        <IssueList
          title="Carryover / Not Completed"
          issues={report.notCompleted}
          emptyText="No carryover — all issues completed!"
          variant="carryover"
        />
      </div>

      <Separator />

      {/* ── (8) AI executive summary (full-width) ─────────────────────────── */}
      <AiSummarySection
        report={report}
        aiStatus={aiStatus}
        aiSummary={aiSummary}
        aiLoading={aiLoading}
        aiError={aiError}
        onDraft={onDraftAi}
      />
    </article>
  );
}

// ── Board toggle (v1.6, ADR-017) — segmented control in the Reports header ───

interface ReportsBoardToggleProps {
  selectedKey: BoardKey;
  onChange: (key: BoardKey) => void;
}

function ReportsBoardToggle({ selectedKey, onChange }: ReportsBoardToggleProps) {
  // a11y: role="group" with label; each segment has aria-pressed
  return (
    <div
      role="group"
      aria-label="Board"
      className="flex items-center gap-1 rounded-md border border-border bg-muted p-0.5"
    >
      {(["dev", "po"] as const).map((key) => {
        const label = key === "dev" ? "Dev" : "PO";
        const pressed = selectedKey === key;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={pressed}
            onClick={() => onChange(key)}
            className={`
              px-3 py-1 rounded-sm text-xs font-semibold transition-colors
              ${pressed
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-background/60"}
            `}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ── Main Reports page ─────────────────────────────────────────────────────────

// v1.13 (ADR-024): controlled by App's shared board+sprint when props present.
export function Reports({
  boardKey: boardKeyProp,
  sprintId: sprintIdProp,
  onBoardChange,
  onSprintChange,
}: SharedSprintProps = {}) {
  // ── v1.6 (ADR-017): board context ───────────────────────────────────────────
  const { boards, loading: boardsLoading } = useBoards();
  const [localBoardKey, setLocalBoardKey] = useState<BoardKey>("dev");
  const selectedBoardKey = boardKeyProp ?? localBoardKey;

  // Numeric id for the selected board — undefined until boards loads (tools use server default)
  const selectedBoardId: number | undefined =
    boards ? boards[selectedBoardKey].id : undefined;

  // ── Sprint picker state ─────────────────────────────────────────────────────
  const sprintList = useSprintList("all", selectedBoardId);
  // localSprintId holds the page DEFAULT (set by the effect) + uncontrolled picks.
  const [localSprintId, setLocalSprintId] = useState<number | null>(null);
  // Effective sprint (v1.13): an explicit shared pick (controlled) overrides the default.
  const selectedSprintId: number | null =
    onSprintChange && (sprintIdProp ?? null) !== null
      ? (sprintIdProp ?? null)
      : localSprintId;
  const setSprintSelection = (id: number) => {
    if (onSprintChange) onSprintChange(id);
    else setLocalSprintId(id);
  };

  // Default-select: first of closed[], else first of active[] → into LOCAL state only.
  const sprintListRef = useRef(false);
  useEffect(() => {
    if (sprintList.data && !sprintListRef.current) {
      sprintListRef.current = true;
      const { closed, active } = sprintList.data;
      if (closed.length > 0) {
        setLocalSprintId(closed[0].id);
      } else if (active.length > 0) {
        setLocalSprintId(active[0].id);
      }
    }
  }, [sprintList.data]);

  // v1.6: switching board resets the sprint selection and the sprint-list auto-select flag
  const handleBoardChange = (key: BoardKey) => {
    if (onBoardChange) onBoardChange(key);
    else setLocalBoardKey(key);
    setLocalSprintId(null);
    sprintListRef.current = false;
  };

  // ── Per-sprint report ───────────────────────────────────────────────────────
  const reportState = useSprintReport(selectedSprintId, selectedBoardId);

  // ── v1.5 (ADR-016): leaves state — propagated up from LeavesCalendarCard ────
  // byAssigneeLeaveDays is a count-based map (assigneeName → working days off).
  // It feeds the ByAssigneeTable Leaves column and the capacity model.
  const [byAssigneeLeaveDays, setByAssigneeLeaveDays] = useState<Record<string, number>>({});

  // Reset leaves display when sprint changes
  useEffect(() => {
    setByAssigneeLeaveDays({});
  }, [selectedSprintId]);

  // ── Velocity — v1.5 (ADR-015) + v1.6 (ADR-017): pass boardId ──────────────
  // perf: velocity + report load in parallel (both start as soon as sprintId is set)
  const velocityState = useVelocity(selectedSprintId, selectedBoardId);

  // ── AI status ───────────────────────────────────────────────────────────────
  const [aiStatus, setAiStatus] = useState<AiStatus>({
    enabled: false,
    provider: null,
    model: null,
  });
  useEffect(() => {
    // perf: non-blocking — AI status failure is safe (defaults to disabled)
    void getAiStatus().then(setAiStatus);
  }, []);

  // ── AI summary state ────────────────────────────────────────────────────────
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<McpError | null>(null);

  // Reset AI summary when sprint changes
  useEffect(() => {
    setAiSummary(null);
    setAiError(null);
  }, [selectedSprintId]);

  function handleDraftAi() {
    if (!reportState.data) return;
    const r = reportState.data;
    const body: SprintSummaryRequest = {
      sprintName: r.sprint.name,
      state: r.sprint.state,
      startDate: r.sprint.startDate ?? undefined,
      endDate: r.sprint.endDate ?? undefined,
      goal: r.sprint.goal,
      committedPoints: r.committedPoints,
      completedPoints: r.completedPoints,
      completedCount: r.completedCount,
      totalCount: r.totalCount,
      carryoverCount: r.carryoverCount,
      blockedCount: r.blockedCount,
      byAssignee: r.byAssignee,
    };
    setAiLoading(true);
    setAiError(null);
    aiSprintSummary(body)
      .then((res) => {
        setAiSummary(res.summary);
        setAiLoading(false);
      })
      .catch((err: unknown) => {
        setAiError(
          err && typeof err === "object" && "code" in err && "message" in err
            ? (err as McpError)
            : { code: "UNKNOWN", message: String(err) }
        );
        setAiLoading(false);
      });
  }

  // ── Derive picker options ───────────────────────────────────────────────────
  const closed = sprintList.data?.closed ?? [];
  const active = sprintList.data?.active ?? [];
  const hasOptions = closed.length > 0 || active.length > 0;

  // v1.5: velocity has "before this sprint" context when selectedSprintId is set
  const velocityHasContext = selectedSprintId !== null;

  // v1.6: friendly label for the selected board
  const boardLabel = selectedBoardKey === "po" ? "PO" : "Dev";

  // ── Page render ─────────────────────────────────────────────────────────────
  //
  // v1.5 (ADR-016) layout: full-width — no max-w constraint.
  // v1.6 (ADR-017): board toggle at the top.
  // The sprint picker card is full-width at the top (always visible).
  // Report body uses a dashboard grid below it.
  return (
    <div className="w-full space-y-4">
      {/* Page title — v1.3 typographic scale */}
      <div className="flex items-center gap-3 print-report-header flex-wrap">
        <FileText className="h-6 w-6 text-primary" aria-hidden="true" />
        <h1 className="text-xl font-semibold text-foreground">Reports</h1>
        {/* v1.6 (ADR-017): Board toggle — only shown when boards is loaded */}
        {!boardsLoading && boards !== null && (
          <ReportsBoardToggle
            selectedKey={selectedBoardKey}
            onChange={handleBoardChange}
          />
        )}
      </div>

      {/* ── (1) Sprint picker card (full-width) ─────────────────────────── */}
      <Card className="shadow-sm print:hidden">
        <CardContent className="pt-4 pb-4">
          {sprintList.loading && (
            <div aria-busy="true" aria-label="Loading sprint list" className="flex gap-2">
              <Skeleton className="h-9 w-48" />
            </div>
          )}
          {sprintList.error && (
            <BridgeDownAlert
              error={sprintList.error}
              onRetry={sprintList.run}
            />
          )}
          {!sprintList.loading && !sprintList.error && !hasOptions && (
            <p className="text-sm text-muted-foreground">
              No sprints found on the {boardLabel} board. Switch to the Dev board or start a sprint in Jira to see reports here.
            </p>
          )}
          {!sprintList.loading && !sprintList.error && hasOptions && (
            <SprintPicker
              closed={closed}
              active={active}
              selectedId={selectedSprintId}
              onChange={(id) => setSprintSelection(id)}
            />
          )}
        </CardContent>
      </Card>

      {/* ── Full-width dashboard report body ────────────────────────────── */}
      {selectedSprintId !== null && (
        <>
          {reportState.loading && (
            <Card className="shadow-sm">
              <CardContent className="pt-5">
                <ReportSkeleton />
              </CardContent>
            </Card>
          )}

          {reportState.error && !reportState.loading && (
            <BridgeDownAlert error={reportState.error} onRetry={reportState.run} />
          )}

          {reportState.data && !reportState.loading && !reportState.error && (
            <SprintReportView
              report={reportState.data}
              velocity={velocityState.data}
              velocityLoading={velocityState.loading}
              velocityError={velocityState.error}
              velocityHasContext={velocityHasContext}
              selectedSprintId={selectedSprintId}
              byAssigneeLeaveDays={byAssigneeLeaveDays}
              onLeavesChange={setByAssigneeLeaveDays}
              aiStatus={aiStatus}
              aiSummary={aiSummary}
              aiLoading={aiLoading}
              aiError={aiError}
              onDraftAi={handleDraftAi}
            />
          )}
        </>
      )}

      {/* Empty state: no sprint selected yet (no sprints) */}
      {!sprintList.loading && !sprintList.error && !hasOptions && (
        <div className="text-center py-12 text-muted-foreground">
          <FileText className="h-10 w-10 mx-auto mb-3 opacity-40" aria-hidden="true" />
          <p className="text-base font-medium text-foreground">No sprints yet</p>
          <p className="text-sm mt-1">
            Sprint reports appear here once you have at least one sprint in Jira.
          </p>
        </div>
      )}
    </div>
  );
}
