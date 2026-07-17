// DeveloperKpiSection — per-developer Trends & KPIs picker + tiles + chart (v1.59, ADR-071).
// Deliberately locked out of scope: no reliability/throughput/capacity KPIs — just avgDonePoints,
// sprintsActive, and a per-sprint donePoints trend (0 when the developer had no issues that
// sprint). Uses a NATIVE <select> — Radix Select is jsdom-hostile (ADR-009).

import { useMemo, useState } from "react";
import { UserRound } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { formatPoints } from "../../lib/format";
import { MultiSprintBarChart } from "./MultiSprintBarChart";
import type { MultiSprintReport } from "../../lib/types";

export function DeveloperKpiSection({ report }: { report: MultiSprintReport }) {
  // report.byAssignee is already sorted donePoints desc (backend contract) — names[0] IS
  // "top donePoints", so no extra sort is needed here.
  const names = report.byAssignee.map((a) => a.name);
  const [selected, setSelected] = useState<string | null>(names[0] ?? null);

  // Keep the selection valid across a window change that drops the previously-picked dev
  // (e.g. they had no issues in the new window) — fall back to the new top donePoints name.
  const effectiveSelected = selected !== null && names.includes(selected) ? selected : names[0] ?? null;
  const summary = report.byAssignee.find((a) => a.name === effectiveSelected) ?? null;

  const series = useMemo(
    () =>
      report.sprints.map((e) => {
        const match = e.byAssignee.find((a) => a.name === effectiveSelected);
        return { label: e.sprint.name, primary: match?.donePoints ?? 0 };
      }),
    [report.sprints, effectiveSelected]
  );

  if (names.length === 0 || summary === null) {
    return (
      <Card className="shadow-sm h-full">
        <CardHeader className="pb-2">
          <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
            <UserRound className="h-4 w-4 text-primary" aria-hidden="true" />
            Developer KPIs
          </h3>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No assignee data in this window.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-sm h-full">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
            <UserRound className="h-4 w-4 text-primary" aria-hidden="true" />
            Developer KPIs
          </h3>
          <div>
            <label htmlFor="trends-dev-picker" className="sr-only">
              Select developer
            </label>
            {/* a11y: NATIVE <select> — Radix Select is jsdom-hostile (ADR-009) */}
            <select
              id="trends-dev-picker"
              value={effectiveSelected ?? ""}
              onChange={(e) => setSelected(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-ring transition-card"
              aria-label="Select developer"
            >
              {names.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-lg bg-muted p-3 text-center">
            <p className="text-xs text-muted-foreground mb-0.5">Avg done pts / sprint</p>
            <p className="text-lg font-bold text-foreground tabular-nums">
              {formatPoints(summary.avgDonePoints)}
            </p>
          </div>
          <div className="rounded-lg bg-[hsl(var(--info-bg))] border border-[hsl(var(--info-border))] p-3 text-center flex flex-col items-center justify-center">
            <p className="text-xs text-muted-foreground">
              Active in{" "}
              <span className="font-semibold text-[hsl(var(--info))] tabular-nums">
                {summary.sprintsActive}
              </span>{" "}
              of{" "}
              <span className="font-semibold text-foreground tabular-nums">{report.sprintCount}</span>{" "}
              sprints
            </p>
          </div>
        </div>

        <MultiSprintBarChart
          title={`${effectiveSelected}'s done points per sprint`}
          series={series}
          primaryLabel="Done"
        />

        <div className="overflow-x-auto">
          <table className="w-full text-xs" aria-label={`${effectiveSelected}'s per-sprint points`}>
            <thead>
              <tr className="border-b border-border text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
                <th className="text-left pb-1.5 pr-3">Sprint</th>
                <th className="text-right pb-1.5 pl-3">Done pts</th>
              </tr>
            </thead>
            <tbody>
              {report.sprints.map((e) => {
                const match = e.byAssignee.find((a) => a.name === effectiveSelected);
                return (
                  <tr key={e.sprint.id} className="border-b border-border/50 last:border-0">
                    <td className="py-1.5 pr-3 text-foreground">{e.sprint.name}</td>
                    <td className="py-1.5 pl-3 text-right tabular-nums text-muted-foreground">
                      {formatPoints(match?.donePoints ?? 0)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
