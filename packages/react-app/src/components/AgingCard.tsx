// AgingCard (v1.58, ADR-070) — Scrum Work Item Age on the Huddle sidebar. Lists every tracked
// in-flight ticket worst-first (a mini WIP-age view), each aged against a points-scaled
// expectation via the pure computeAging(). Presentational otherwise.
//
// This shows ALL in-flight work with a known age — the standup question is "what's been sitting
// too long?", which needs the whole list ordered, not just a flagged subset. v1.60 (ADR-072):
// now the Huddle's sole such signal card (the earlier flagged-outliers-only nudge card was
// retired). A "Show all N / Show less" toggle (below MAX_SHOWN entries, per-visit only — not
// persisted) reveals the full list in a scrollable region so a deep WIP list stays usable.

import { useState } from "react";
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
  sprintStartDate,
}: {
  issues: IssueSummary[];
  policy: AgingPolicy;
  /** v1.61 (ADR-073, item 174) — clamps displayed age to max(inProgressSince, sprintStartDate)
   *  so a carried-over ticket's clock starts at sprint start. Omitted/null → unclamped. */
  sprintStartDate?: string | null;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const { entries, okCount, watchCount, overdueCount } = computeAging(issues, policy, today, sprintStartDate);
  const [collapsed, toggleCollapsed] = useCollapse("aging");
  // v1.60 (ADR-072): "Show all" is per-visit only — deliberately NOT persisted like the card's
  // own collapse state above (useCollapse), which survives reloads.
  const [expanded, setExpanded] = useState(false);

  const canExpand = entries.length > MAX_SHOWN;
  const shown = expanded ? entries : entries.slice(0, MAX_SHOWN);
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
              <ul
                className={cn("space-y-1.5", expanded && "max-h-80 overflow-y-auto")}
                aria-label="Ticket aging"
              >
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
              </ul>
              {canExpand && (
                <button
                  type="button"
                  onClick={() => setExpanded((cur) => !cur)}
                  aria-expanded={expanded}
                  className="mt-1.5 text-[0.6875rem] text-muted-foreground hover:underline"
                >
                  {expanded ? "Show less" : `Show all ${entries.length}`}
                </button>
              )}
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}
