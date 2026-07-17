// TeamKpiSection — team-level Trends & KPIs tiles + chart (v1.59, ADR-071).
// Deliberately locked out of scope: no forecast tile, no best/worst-sprint tile — just the two
// averages the backend already computes (averageCompleted, averageCompletionRate) plus a
// completed-vs-committed trend chart. Presentational; matches Reports.tsx's card/tile styling.

import { TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { formatPoints } from "../../lib/format";
import { MultiSprintBarChart } from "./MultiSprintBarChart";
import type { MultiSprintReport } from "../../lib/types";

export function TeamKpiSection({ report }: { report: MultiSprintReport }) {
  const series = report.sprints.map((e) => ({
    label: e.sprint.name,
    primary: e.completedPoints,
    secondary: e.committedPoints,
  }));

  return (
    <Card className="shadow-sm h-full">
      <CardHeader className="pb-2">
        <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" aria-hidden="true" />
          Team KPIs
        </h3>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-lg bg-muted p-3 text-center">
            <p className="text-xs text-muted-foreground mb-0.5">Avg completed / sprint</p>
            <p className="text-lg font-bold text-foreground tabular-nums">
              {formatPoints(report.averageCompleted)}
            </p>
            <p className="text-[0.6875rem] text-muted-foreground">pts</p>
          </div>
          <div className="rounded-lg bg-[hsl(var(--info-bg))] border border-[hsl(var(--info-border))] p-3 text-center">
            <p className="text-xs text-muted-foreground mb-0.5">Avg completion rate</p>
            <p className="text-lg font-bold text-[hsl(var(--info))] tabular-nums">
              {Math.round(report.averageCompletionRate * 100)}%
            </p>
          </div>
        </div>

        <MultiSprintBarChart
          title="Completed vs. committed per sprint"
          series={series}
          primaryLabel="Completed"
          secondaryLabel="Committed"
        />
      </CardContent>
    </Card>
  );
}
