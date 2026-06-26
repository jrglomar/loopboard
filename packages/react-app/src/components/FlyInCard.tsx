// FlyInCard — Huddle "Fly-in" tracking (v1.23, ADR-035; horizontal + status v1.24).
// Full-width strip of current-sprint tickets whose title is LIKE "FLY IN", each with its status.
// Derived from the already-loaded sprint board issues — no extra fetch.

import { Plane, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { IssueSummary } from "../lib/types";

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

export function FlyInCard({ flyIns }: { flyIns: IssueSummary[] }) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="px-4 pt-3 pb-2">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          <Plane className="h-4 w-4 text-primary" aria-hidden="true" />
          Fly-in tracking
          {flyIns.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              ({flyIns.length})
            </span>
          )}
        </h3>
      </CardHeader>
      <CardContent className="px-4 pb-3 pt-0">
        {flyIns.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No fly-in tickets this sprint.
          </p>
        ) : (
          <ul
            className="flex flex-wrap gap-2"
            role="list"
            aria-label="Fly-in tickets"
          >
            {flyIns.map((t) => (
              <li
                key={t.key}
                className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm min-w-0 w-full"
              >
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
                <span
                  className="flex-1 min-w-0 text-xs text-foreground"
                  title={t.summary}
                >
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
                  <span
                    className="text-[0.6875rem] text-muted-foreground flex-shrink-0"
                    title={t.assignee}
                  >
                    {t.assignee}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
