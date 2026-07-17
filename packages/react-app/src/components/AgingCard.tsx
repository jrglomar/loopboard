// AgingCard (v1.58, ADR-070) — Scrum Work Item Age on the Huddle sidebar. Lists every tracked
// in-flight ticket worst-first (a mini WIP-age view), each aged against a points-scaled
// expectation via the pure computeAging(). Presentational otherwise.
//
// Unlike AttentionCard (which only shows flagged outliers), this shows ALL in-flight work with a
// known age — the standup question is "what's been sitting too long?", which needs the whole list
// ordered, not just the exceptions.

import { Hourglass, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { computeAging, agingDetail, type AgingTier } from "../lib/aging";
import { useCollapse } from "../hooks/useCollapse";
import { CollapseToggle } from "./CollapseToggle";
import { cn } from "@/lib/utils";
import type { IssueSummary, AgingPolicy } from "../lib/types";

const MAX_SHOWN = 6;

/** Tier → row accent. Reuses the app's semantic warning/error tokens (PrBadge/SprintBoard). */
const TIER_TEXT: Record<AgingTier, string> = {
  ok: "text-muted-foreground",
  watch: "text-warning-foreground",
  overdue: "text-error",
};

export function AgingCard({
  issues,
  policy,
}: {
  issues: IssueSummary[];
  policy: AgingPolicy;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const { entries, okCount, watchCount, overdueCount } = computeAging(issues, policy, today);
  const [collapsed, toggleCollapsed] = useCollapse("aging");

  const shown = entries.slice(0, MAX_SHOWN);
  const extra = entries.length - shown.length;
  const flagged = overdueCount + watchCount;

  return (
    <Card className="shadow-sm">
      <CardHeader className="px-3 pt-3 pb-1.5">
        <h3 className="text-sm font-semibold text-foreground">
          <CollapseToggle collapsed={collapsed} onToggle={toggleCollapsed} className="w-full">
            <Hourglass className="h-3.5 w-3.5 text-primary shrink-0" aria-hidden="true" />
            Ticket aging
            {flagged > 0 && (
              <span className="ml-auto inline-flex items-center justify-center rounded-full bg-warning-bg text-warning-foreground text-[0.6875rem] font-semibold h-5 min-w-5 px-1.5">
                {flagged}
              </span>
            )}
          </CollapseToggle>
        </h3>
      </CardHeader>
      {!collapsed && (
        <CardContent className="px-3 pb-3">
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> Nothing in progress yet
            </p>
          ) : (
            <>
              <p className="text-[0.6875rem] text-muted-foreground mb-1.5">
                {overdueCount} overdue · {watchCount} watch · {okCount} ok
              </p>
              <ul className="space-y-1.5" aria-label="Ticket aging">
                {shown.map((e) => (
                  <li key={e.key} className="text-sm">
                    <a
                      href={e.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-start gap-1.5 group"
                    >
                      <span
                        className={cn(
                          "text-[0.6875rem] font-semibold tabular-nums mt-0.5 flex-shrink-0 w-8 text-right",
                          TIER_TEXT[e.tier]
                        )}
                      >
                        {e.ageDays}d
                      </span>
                      <span className="min-w-0">
                        <span className="font-medium text-foreground group-hover:underline">{e.key}</span>{" "}
                        <span className="text-muted-foreground break-words">{e.summary}</span>
                        <span className={cn("block text-[0.6875rem]", TIER_TEXT[e.tier])}>
                          {agingDetail(e)}
                        </span>
                      </span>
                    </a>
                  </li>
                ))}
                {extra > 0 && (
                  <li className="text-[0.6875rem] text-muted-foreground pl-9">+{extra} more</li>
                )}
              </ul>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}
