// DeveloperKpiSection — per-developer Trends & KPIs picker + tiles + chart (v1.59, ADR-071;
// leave-adjusted v1.60, ADR-072). Consumes precomputed DevKpi[] (lib/kpiAdjust.ts — the client-side
// join of the report × get_all_leaves × requiredPoints): the dev <select> lists the UNION of
// byAssignee and plotted-leave names (a dev fully on leave with zero tickets still appears), the
// bar chart plots donePoints against the leave-adjusted target, and the table adds Leaves (d) /
// Target (adj) / met columns. Deliberately locked out of scope: no reliability/throughput KPIs.
// Uses a NATIVE <select> — Radix Select is jsdom-hostile (ADR-009).

import { useMemo, useState } from "react";
import { FileSpreadsheet, UserRound } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatPoints } from "../../lib/format";
import { buildDeveloperKpisWorkbook } from "../../lib/trendsXlsx"; // v1.61 (ADR-073, item 177)
import { saveBlob } from "../SprintReviewExport";
import { MultiSprintBarChart } from "./MultiSprintBarChart";
import type { DevKpi } from "../../lib/kpiAdjust";
import type { MultiSprintReport } from "../../lib/types";

export function DeveloperKpiSection({
  report,
  devKpis,
  leavesLoading = false,
  boardLabel = "Dev",
  boardSlug = "dev",
}: {
  /** Kept for the window size (sprint names/order also live on each DevKpi.perSprint). */
  report: MultiSprintReport;
  /** Leave-adjusted per-dev KPIs — sorted totals.donePoints desc, tie name asc (kpiAdjust.ts). */
  devKpis: DevKpi[];
  /** v1.60 — true while the leaves store is still loading (targets shown unadjusted meanwhile). */
  leavesLoading?: boolean;
  /** v1.61 (ADR-073, item 177) — friendly board label for the styled xlsx workbook's title band. */
  boardLabel?: string;
  /** v1.61 (ADR-073, item 177) — url-safe board slug for the styled xlsx download's filename. */
  boardSlug?: string;
}) {
  // devKpis is already sorted donePoints desc (kpiAdjust contract) — names[0] IS "top donePoints",
  // so no extra sort is needed here.
  const names = devKpis.map((k) => k.name);
  const [selected, setSelected] = useState<string | null>(names[0] ?? null);

  // Keep the selection valid across a window change that drops the previously-picked dev
  // (e.g. they had no issues or leaves in the new window) — fall back to the new top name.
  const effectiveSelected = selected !== null && names.includes(selected) ? selected : names[0] ?? null;
  const dev = devKpis.find((k) => k.name === effectiveSelected) ?? null;

  const series = useMemo(
    () =>
      (dev?.perSprint ?? []).map((s) => ({
        label: s.sprintName,
        primary: s.donePoints,
        secondary: s.adjustedTarget,
      })),
    [dev]
  );

  if (names.length === 0 || dev === null) {
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

  const activeCount = dev.perSprint.filter((s) => s.active).length;

  // v1.61 (ADR-073, item 177): styled workbook of EVERY dev's leave-adjusted per-sprint KPIs
  // (not just the one selected above) — a SEPARATE download from the team-trends button in
  // TrendsView's own export bar.
  function handleDownloadXlsx() {
    const bytes = buildDeveloperKpisWorkbook(devKpis, boardLabel);
    saveBlob(
      new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `trends-devs-${boardSlug}.xlsx`
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
          <div className="flex items-center gap-2">
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
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={handleDownloadXlsx}
              aria-label="Export developer KPIs as styled Excel workbook"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
              Export .xlsx
            </Button>
          </div>
        </div>
        {leavesLoading && (
          <p className="text-[0.6875rem] text-muted-foreground" aria-live="polite">
            (leaves loading…)
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-lg bg-muted p-3 text-center">
            <p className="text-xs text-muted-foreground mb-0.5">Avg done pts / sprint</p>
            <p className="text-lg font-bold text-foreground tabular-nums">
              {formatPoints(dev.avgDonePoints)}
            </p>
          </div>
          {/* v1.60 (ADR-072): met = donePoints >= max(0, requiredPoints − leaveDays) per sprint */}
          <div className="rounded-lg bg-muted p-3 text-center">
            <p className="text-xs text-muted-foreground mb-0.5">Met target</p>
            <p className="text-lg font-bold text-foreground tabular-nums">
              {dev.metCount} of {dev.sprintCount}
            </p>
            <p className="text-[0.6875rem] text-muted-foreground">sprints</p>
          </div>
          <div className="rounded-lg bg-[hsl(var(--info-bg))] border border-[hsl(var(--info-border))] p-3 text-center flex flex-col items-center justify-center">
            <p className="text-xs text-muted-foreground">
              Active in{" "}
              <span className="font-semibold text-[hsl(var(--info))] tabular-nums">{activeCount}</span>{" "}
              of{" "}
              <span className="font-semibold text-foreground tabular-nums">{report.sprintCount}</span>{" "}
              sprints
            </p>
          </div>
        </div>

        <MultiSprintBarChart
          title={`${effectiveSelected}'s done points vs. adjusted target per sprint`}
          series={series}
          primaryLabel="Done"
          secondaryLabel="Target (adj)"
        />

        <div className="overflow-x-auto">
          <table className="w-full text-xs" aria-label={`${effectiveSelected}'s per-sprint points`}>
            <thead>
              <tr className="border-b border-border text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
                <th className="text-left pb-1.5 pr-3">Sprint</th>
                <th className="text-right pb-1.5 pl-3">Done pts</th>
                <th className="text-right pb-1.5 pl-3">Leaves (d)</th>
                <th className="text-right pb-1.5 pl-3">Target (adj)</th>
                <th className="text-center pb-1.5 pl-3">Met</th>
              </tr>
            </thead>
            <tbody>
              {dev.perSprint.map((s) => (
                <tr key={s.sprintId} className="border-b border-border/50 last:border-0">
                  <td className="py-1.5 pr-3 text-foreground">{s.sprintName}</td>
                  <td className="py-1.5 pl-3 text-right tabular-nums text-muted-foreground">
                    {formatPoints(s.donePoints)}
                  </td>
                  <td className="py-1.5 pl-3 text-right tabular-nums text-muted-foreground">
                    {s.leaveDays}
                  </td>
                  <td className="py-1.5 pl-3 text-right tabular-nums text-muted-foreground">
                    {formatPoints(s.adjustedTarget)}
                  </td>
                  {/* a11y: never rely on the glyph alone — aria-label carries the meaning */}
                  <td className="py-1.5 pl-3 text-center">
                    {s.met ? (
                      <span role="img" aria-label="met" className="text-success font-semibold">
                        ✓
                      </span>
                    ) : (
                      <span role="img" aria-label="missed" className="text-error font-semibold">
                        ✗
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
