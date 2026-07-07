// BurndownCard (v1.42, ADR-052) — sprint burndown as a dependency-free SVG line chart.
// Ideal line (dashed, muted) vs actual remaining (solid, primary); the actual line stops
// at "today" for active sprints. Pure math lives in lib/burndown.ts.

import { TrendingDown } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { computeBurndown } from "../lib/burndown";
import { sprintWorkingDays } from "../lib/capacity";
import { formatPoints } from "../lib/format";
import type { SprintReport } from "../lib/types";

// perf: fixed viewBox; the SVG scales responsively via width 100%.
const W = 640;
const H = 220;
const PAD = { left: 44, right: 16, top: 14, bottom: 30 };

function dayLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function BurndownCard({ report }: { report: SprintReport }) {
  const workingDays = sprintWorkingDays(report.sprint.startDate, report.sprint.endDate);
  const today = new Date().toISOString().slice(0, 10);
  const series = computeBurndown(report.committedPoints, report.completed, workingDays, today);

  const cardHeader = (
    <CardHeader className="pb-2">
      <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
        <TrendingDown className="h-4 w-4 text-primary" aria-hidden="true" />
        Burndown
        <span className="text-xs font-normal text-muted-foreground">
          points remaining vs the ideal line — burns on Jira resolution
        </span>
      </h3>
    </CardHeader>
  );

  if (series.days.length === 0 || series.committed <= 0) {
    return (
      <Card className="shadow-sm">
        {cardHeader}
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {series.days.length === 0
              ? "Sprint has no dates — set start/end dates in Jira to chart the burndown."
              : "No committed points to burn down yet."}
          </p>
        </CardContent>
      </Card>
    );
  }

  const n = series.days.length;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => PAD.top + (1 - v / series.committed) * plotH;

  const idealPts = series.days.map((d, i) => `${x(i)},${y(d.ideal)}`).join(" ");
  const actual = series.days
    .map((d, i) => (d.remaining === null ? null : { i, v: d.remaining }))
    .filter((p): p is { i: number; v: number } => p !== null);
  const actualPts = actual.map((p) => `${x(p.i)},${y(p.v)}`).join(" ");

  // x ticks: first, last, and up to 3 evenly spaced in between (avoid label soup)
  const tickIdx = new Set<number>([0, n - 1]);
  for (let t = 1; t <= 3; t++) tickIdx.add(Math.round((t * (n - 1)) / 4));

  return (
    <Card className="shadow-sm">
      {cardHeader}
      <CardContent>
        {/* a11y: labeled img role; the data table equivalent is the by-assignee/report itself */}
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-auto"
          role="img"
          aria-label={`Burndown: ${formatPoints(series.committed)} committed points across ${n} working days`}
        >
          {/* y axis: committed (top) and 0 (bottom) gridlines */}
          {[series.committed, series.committed / 2, 0].map((v) => (
            <g key={v}>
              <line
                x1={PAD.left} y1={y(v)} x2={W - PAD.right} y2={y(v)}
                stroke="hsl(var(--border))" strokeWidth="1"
              />
              <text
                x={PAD.left - 6} y={y(v) + 3} textAnchor="end"
                fontSize="10" fill="hsl(var(--muted-foreground))"
              >
                {formatPoints(Math.round(v * 10) / 10)}
              </text>
            </g>
          ))}

          {/* x tick labels */}
          {series.days.map((d, i) =>
            tickIdx.has(i) ? (
              <text
                key={d.date}
                x={x(i)} y={H - 8} textAnchor="middle"
                fontSize="10" fill="hsl(var(--muted-foreground))"
              >
                {dayLabel(d.date)}
              </text>
            ) : null
          )}

          {/* ideal line (dashed) */}
          <polyline
            points={idealPts}
            fill="none"
            stroke="hsl(var(--muted-foreground))"
            strokeWidth="1.5"
            strokeDasharray="5 4"
            opacity="0.6"
          />

          {/* actual remaining */}
          {series.hasActual && (
            <>
              <polyline
                points={actualPts}
                fill="none"
                stroke="hsl(var(--primary))"
                strokeWidth="2.5"
                strokeLinejoin="round"
              />
              {actual.map((p) => (
                <circle
                  key={p.i}
                  cx={x(p.i)} cy={y(p.v)} r="3"
                  fill="hsl(var(--primary))"
                >
                  <title>{`${dayLabel(series.days[p.i]!.date)}: ${formatPoints(p.v)} pts remaining`}</title>
                </circle>
              ))}
            </>
          )}
        </svg>

        <div className="flex items-center gap-4 mt-1 text-[0.6875rem] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-4 h-0.5 bg-primary rounded" aria-hidden="true" /> Remaining
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-4 border-t border-dashed border-muted-foreground" aria-hidden="true" /> Ideal
          </span>
          <span className="ml-auto">
            Code-review-complete items burn when Jira resolves them.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
