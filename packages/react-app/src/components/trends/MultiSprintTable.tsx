// MultiSprintTable — one row per sprint + a totals/average footer (v1.59, ADR-071).
// Presentational; matches ByAssigneeTable / IssueList's card + table styling in Reports.tsx.

import { Table2 } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { formatPoints } from "../../lib/format";
import type { MultiSprintReport } from "../../lib/types";

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

export function MultiSprintTable({ report }: { report: MultiSprintReport }) {
  const { sprints } = report;

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
          <Table2 className="h-4 w-4 text-primary" aria-hidden="true" />
          Sprint History
        </h3>
      </CardHeader>
      <CardContent>
        {sprints.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sprints in this window.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Multi-sprint report">
              <thead>
                <tr className="border-b border-border text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="text-left pb-2 pr-4">Sprint</th>
                  <th className="text-left pb-2 px-3">Dates</th>
                  <th className="text-right pb-2 px-3">Committed</th>
                  <th className="text-right pb-2 px-3">Completed</th>
                  <th className="text-right pb-2 px-3">Rate</th>
                  <th className="text-right pb-2 px-3">Carryover</th>
                  <th className="text-right pb-2 pl-3">Blocked</th>
                </tr>
              </thead>
              <tbody>
                {sprints.map((entry) => (
                  <tr
                    key={entry.sprint.id}
                    className="border-b border-border/50 hover:bg-muted/30 transition-card"
                  >
                    <td className="py-2 pr-4 font-medium text-foreground">{entry.sprint.name}</td>
                    <td className="py-2 px-3 text-muted-foreground whitespace-nowrap">
                      {formatDate(entry.sprint.startDate)} – {formatDate(entry.sprint.endDate)}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">
                      {formatPoints(entry.committedPoints)}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-[hsl(var(--status-done-text))]">
                      {formatPoints(entry.completedPoints)}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-foreground">
                      {Math.round(entry.completionRate * 100)}%
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">
                      {entry.carryoverCount}
                    </td>
                    <td className="py-2 pl-3 text-right tabular-nums">
                      {entry.blockedCount > 0 ? (
                        <span className="text-[hsl(var(--warning-foreground))] font-medium">
                          {entry.blockedCount}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{entry.blockedCount}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border font-semibold text-foreground">
                  <td className="py-2 pr-4">Total / average</td>
                  <td className="py-2 px-3 text-muted-foreground text-xs font-normal">
                    {sprints.length} sprint{sprints.length !== 1 ? "s" : ""}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums">
                    {formatPoints(report.totals.committedPoints)}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums">
                    {formatPoints(report.totals.completedPoints)}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums">
                    {Math.round(report.averageCompletionRate * 100)}%
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums">
                    {sprints.reduce((n, e) => n + e.carryoverCount, 0)}
                  </td>
                  <td className="py-2 pl-3 text-right tabular-nums">
                    {sprints.reduce((n, e) => n + e.blockedCount, 0)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
