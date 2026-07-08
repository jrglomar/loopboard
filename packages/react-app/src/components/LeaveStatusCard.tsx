// LeaveStatusCard (v1.31, ADR-043) — Huddle widget: who's on leave today + in the coming days.
// Reads the whole leaves store (useAllLeaves) and summarizes it relative to today.

import { CalendarOff } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useAllLeaves } from "../hooks/useJira";
import { useCollapse } from "../hooks/useCollapse";
import { CollapseToggle } from "./CollapseToggle";
import { summarizeLeaveStatus } from "../lib/leaveStatus";
import type { LeaveType } from "../lib/types";

const TYPE_STYLE: Record<LeaveType, string> = {
  VL: "bg-[hsl(var(--info-bg))] text-[hsl(var(--info))]",
  EL: "bg-[hsl(var(--error-bg))] text-[hsl(var(--error))]",
  Holiday: "bg-[hsl(var(--success-bg))] text-[hsl(var(--success))]",
  Offset: "bg-[hsl(var(--accent)/0.12)] text-[hsl(var(--accent))]",
};
const TYPE_LABEL: Record<LeaveType, string> = { VL: "Vacation", EL: "Emergency", Holiday: "Holiday", Offset: "Offset" };

function TypeChip({ type }: { type: LeaveType }) {
  return (
    <span className={cn("text-[0.625rem] font-semibold px-1.5 py-px rounded flex-shrink-0", TYPE_STYLE[type])} title={TYPE_LABEL[type]}>
      {TYPE_LABEL[type]}
    </span>
  );
}

function shortDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

export function LeaveStatusCard({ today }: { today?: string }) {
  const { data, loading } = useAllLeaves();
  const todayIso = today ?? new Date().toISOString().slice(0, 10);
  const status = summarizeLeaveStatus(data, { today: todayIso, horizonDays: 7 });
  const [collapsed, toggleCollapsed] = useCollapse("onLeave");

  return (
    <Card className="shadow-sm">
      <CardHeader className="px-3 pt-3 pb-1.5">
        <h3 className="text-sm font-semibold text-foreground">
          <CollapseToggle collapsed={collapsed} onToggle={toggleCollapsed} className="w-full">
            <CalendarOff className="h-3.5 w-3.5 text-primary shrink-0" aria-hidden="true" />
            On leave
            {status.today.length > 0 && (
              <span className="text-xs font-normal text-muted-foreground">({status.today.length} out today)</span>
            )}
          </CollapseToggle>
        </h3>
      </CardHeader>
      {!collapsed && (
      <CardContent className="px-3 pb-3 space-y-2">
        {/* Out today */}
        <div>
          <p className="text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Today</p>
          {status.today.length === 0 ? (
            <p className="text-sm text-muted-foreground">{loading ? "Loading…" : "Everyone's in today."}</p>
          ) : (
            <ul className="space-y-1" role="list" aria-label="On leave today">
              {status.today.map((r) => (
                <li key={`${r.assignee}-today`} className="flex items-center gap-2 text-sm">
                  <span className="flex-1 min-w-0 truncate text-foreground">{r.assignee}</span>
                  <TypeChip type={r.type} />
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Upcoming */}
        <div>
          <p className="text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Next 7 days</p>
          {status.upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">No upcoming leave.</p>
          ) : (
            <ul className="space-y-1" role="list" aria-label="Upcoming leave">
              {status.upcoming.map((r) => (
                <li key={`${r.assignee}-${r.date}`} className="flex items-center gap-2 text-sm">
                  <span className="flex-1 min-w-0 truncate text-foreground">{r.assignee}</span>
                  <span className="text-[0.6875rem] text-muted-foreground whitespace-nowrap" title={r.date}>
                    {shortDate(r.date)} · in {r.daysAway}d
                  </span>
                  <TypeChip type={r.type} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
      )}
    </Card>
  );
}
