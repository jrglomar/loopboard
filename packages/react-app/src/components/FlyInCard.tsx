// FlyInCard — Huddle "Fly-in" tracking.
//   v1.23 (ADR-035): card listing current-sprint tickets whose title is LIKE "FLY IN".
//   v1.24 (ADR-036): full-width strip + per-ticket status pill.
//   v1.27 (ADR-040): DUAL — separate Dev-board + PO-board groups, and each PO fly-in shows
//     whether it has an ALIGNED Dev fly-in (a linked Dev issue whose title is also a fly-in),
//     derived from get_linked_issues. Derived from already-loaded sprint issues + one links fetch.

import type { ReactNode } from "react";
import { Plane, ExternalLink, CheckCircle2, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { IssueSummary, LinkedIssue } from "../lib/types";

/** True when a ticket summary reads like a "Fly in" item (matches "fly in" / "fly-in" / "flyin").
 *  Word-boundary anchored so e.g. "butterfly inside" does NOT match. */
export function matchFlyIn(summary: string): boolean {
  return /\bfly[\s_-]*in\b/i.test(summary);
}

/** Pick the fly-in tickets out of a flat issue list. */
export function selectFlyIns(issues: IssueSummary[]): IssueSummary[] {
  return issues.filter((i) => matchFlyIn(i.summary));
}

/** Tinted status pill, colored by the issue's status category. */
const STATUS_STYLE: Record<IssueSummary["statusCategory"], string> = {
  todo: "bg-[hsl(var(--status-todo-bg))] text-[hsl(var(--status-todo-text))] border-[hsl(var(--status-todo-border))]",
  inprogress:
    "bg-[hsl(var(--status-inprogress-bg))] text-[hsl(var(--status-inprogress-text))] border-[hsl(var(--status-inprogress-border))]",
  done: "bg-[hsl(var(--status-done-bg))] text-[hsl(var(--status-done-text))] border-[hsl(var(--status-done-border))]",
};

/** One fly-in ticket chip; `alignment` (optional) renders an indicator on the right (PO group). */
function FlyInChip({ t, alignment }: { t: IssueSummary; alignment?: ReactNode }) {
  return (
    <li className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm min-w-0 w-full">
      <a
        href={t.url}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-[0.6875rem] text-primary hover:underline inline-flex items-center gap-0.5 flex-shrink-0"
        aria-label={`Open ${t.key} in a new tab`}
        title={t.url}
      >
        {t.key}
        <ExternalLink className="h-3 w-3" aria-hidden="true" />
      </a>
      <span className="flex-1 min-w-0 text-xs text-foreground" title={t.summary}>
        {t.summary}
        <span
          className={cn(
            "flex-shrink-0 rounded border px-1.5 py-px text-[0.625rem] font-medium whitespace-nowrap mx-2",
            STATUS_STYLE[t.statusCategory],
          )}
          title={`Status: ${t.status}`}
        >
          {t.status}
        </span>
      </span>

      {t.assignee && (
        <span className="text-[0.6875rem] text-muted-foreground flex-shrink-0" title={t.assignee}>
          {t.assignee}
        </span>
      )}
      {alignment}
    </li>
  );
}

/** Alignment indicator for a PO fly-in: green link to the aligned Dev fly-in, or an amber warning. */
function AlignmentBadge({ aligned }: { aligned: LinkedIssue | null | undefined }) {
  if (aligned) {
    return (
      <a
        href={aligned.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-0.5 text-[0.625rem] font-semibold px-1.5 h-5 rounded border bg-success-bg text-success border-success-border hover:underline flex-shrink-0"
        title={`Aligned with Dev fly-in ${aligned.key}: ${aligned.summary}`}
        aria-label={`Aligned with Dev fly-in ${aligned.key}`}
      >
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
        {aligned.key}
      </a>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-0.5 text-[0.625rem] font-semibold px-1.5 h-5 rounded border bg-warning-bg text-warning-foreground border-warning-border flex-shrink-0"
      title="No aligned Dev fly-in found among this ticket's linked Dev issues"
      aria-label="No aligned Dev fly-in"
    >
      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
      No Dev fly-in
    </span>
  );
}

function FlyInGroup({ label, items, alignmentFor }: {
  label: string;
  items: IssueSummary[];
  /** When provided (PO group), renders an alignment badge per ticket. */
  alignmentFor?: (key: string) => LinkedIssue | null | undefined;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
        {label} <span className="font-normal normal-case">({items.length})</span>
      </p>
      <ul className="flex flex-col gap-2" role="list" aria-label={`${label} fly-in tickets`}>
        {items.map((t) => (
          <FlyInChip
            key={t.key}
            t={t}
            alignment={alignmentFor ? <AlignmentBadge aligned={alignmentFor(t.key)} /> : undefined}
          />
        ))}
      </ul>
    </div>
  );
}

export function FlyInCard({
  devFlyIns,
  poFlyIns,
  poAlignment,
}: {
  devFlyIns: IssueSummary[];
  poFlyIns: IssueSummary[];
  /** Per PO fly-in key → its aligned Dev fly-in (or null when none). Omit to hide alignment. */
  poAlignment?: Record<string, LinkedIssue | null>;
}) {
  const total = devFlyIns.length + poFlyIns.length;
  return (
    <Card className="shadow-sm">
      <CardHeader className="px-4 pt-3 pb-2">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          <Plane className="h-4 w-4 text-primary" aria-hidden="true" />
          Fly-in tracking
          {total > 0 && <span className="text-xs font-normal text-muted-foreground">({total})</span>}
        </h3>
      </CardHeader>
      <CardContent className="px-4 pb-3 pt-0 space-y-3">
        {total === 0 ? (
          <p className="text-sm text-muted-foreground">No fly-in tickets this sprint.</p>
        ) : (
          <>
            <FlyInGroup label="Dev board" items={devFlyIns} />
            <FlyInGroup
              label="PO board"
              items={poFlyIns}
              alignmentFor={poAlignment ? (key) => poAlignment[key] : undefined}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
