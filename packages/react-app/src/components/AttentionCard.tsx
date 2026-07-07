// AttentionCard (v1.42, ADR-052) — a compact "needs attention" nudge list at the top of the
// Huddle sidebar. Derives prioritized items from the current sprint's issues + linked PRs via
// the pure buildAttention(); presentational otherwise. Empty state = "All clear".

import { AlertTriangle, Clock, UserX, GitPullRequest, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { buildAttention, type AttentionKind } from "../lib/attention";
import type { IssueSummary, LinkedPr } from "../lib/types";

const KIND_ICON: Record<AttentionKind, typeof Clock> = {
  stale: Clock,
  unassigned: UserX,
  pr_review: GitPullRequest,
};

const MAX_SHOWN = 6;

export function AttentionCard({
  issues,
  prsByKey,
  staleDays = 3,
}: {
  issues: IssueSummary[];
  prsByKey: Record<string, LinkedPr[]>;
  staleDays?: number;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const { items } = buildAttention({ issues, prsByKey, today, staleDays });

  const shown = items.slice(0, MAX_SHOWN);
  const extra = items.length - shown.length;

  return (
    <Card className="shadow-sm">
      <CardHeader className="px-3 pt-3 pb-1.5">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
          Needs attention
          {items.length > 0 && (
            <span className="ml-auto inline-flex items-center justify-center rounded-full bg-amber-100 text-amber-700 text-[0.6875rem] font-semibold h-5 min-w-5 px-1.5">
              {items.length}
            </span>
          )}
        </h3>
      </CardHeader>
      <CardContent className="px-3 pb-3">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> All clear
          </p>
        ) : (
          <ul className="space-y-1.5">
            {shown.map((item, i) => {
              const Icon = KIND_ICON[item.kind];
              return (
                <li key={`${item.kind}-${item.key}-${i}`} className="text-sm">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-1.5 group"
                  >
                    <Icon className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="font-medium text-foreground group-hover:underline">{item.key}</span>{" "}
                      <span className="text-muted-foreground break-words">{item.summary}</span>
                      <span className="block text-[0.6875rem] text-muted-foreground">{item.detail}</span>
                    </span>
                  </a>
                </li>
              );
            })}
            {extra > 0 && (
              <li className="text-[0.6875rem] text-muted-foreground pl-5">+{extra} more</li>
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
