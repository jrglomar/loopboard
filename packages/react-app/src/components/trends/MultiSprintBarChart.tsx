// MultiSprintBarChart — generic dependency-free CSS-bar chart for Trends & KPIs (v1.59, ADR-071).
//
// Lifts the CSS-bar technique from Reports.tsx's inline VelocityChart (committed-vs-completed
// bars, scaled to the series max, minimum 2px so a zero value still shows a sliver) WITHOUT
// importing or modifying that file — this is a fresh, generic component so both the team and
// developer KPI sections (and any future caller) can reuse one implementation.
//
// perf: pure CSS bars — no canvas/SVG library; renders instantly.

import { formatPoints } from "../../lib/format";

export interface MultiSprintBarChartSeries {
  label: string;
  primary: number;
  secondary?: number;
}

export interface MultiSprintBarChartProps {
  title?: string;
  series: MultiSprintBarChartSeries[];
  primaryLabel: string;
  secondaryLabel?: string;
}

const BAR_MAX_HEIGHT = 96; // px — matches Reports.tsx's velocity chart

export function MultiSprintBarChart({
  title,
  series,
  primaryLabel,
  secondaryLabel,
}: MultiSprintBarChartProps) {
  if (series.length === 0) {
    return <p className="text-sm text-muted-foreground py-2">No sprint data to chart.</p>;
  }

  const hasSecondary = series.some((s) => s.secondary !== undefined);
  const maxValue = Math.max(...series.map((s) => Math.max(s.primary, s.secondary ?? 0)), 1); // avoid div/0

  return (
    <figure aria-label={title ? `${title} — bar chart` : "Bar chart"}>
      {(title || hasSecondary) && (
        <div className="flex items-start justify-between gap-2 flex-wrap mb-2">
          {title && <h4 className="text-sm font-semibold text-foreground">{title}</h4>}
          {hasSecondary && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground ml-auto">
              <span className="flex items-center gap-1">
                <span className="inline-block w-3 h-3 rounded-sm bg-muted border border-border" aria-hidden="true" />
                {secondaryLabel ?? "Secondary"}
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-3 h-3 rounded-sm bg-[hsl(var(--status-done))]" aria-hidden="true" />
                {primaryLabel}
              </span>
            </div>
          )}
        </div>
      )}

      <div
        className="flex items-end gap-2 overflow-x-auto pb-2"
        style={{ minHeight: `${BAR_MAX_HEIGHT + 32}px` }}
        role="img"
        aria-label="Bar chart"
      >
        {series.map((s, i) => {
          const primaryH = Math.max(Math.round((s.primary / maxValue) * BAR_MAX_HEIGHT), 2);
          const secondaryH =
            s.secondary !== undefined
              ? Math.max(Math.round((s.secondary / maxValue) * BAR_MAX_HEIGHT), 2)
              : null;
          const barAriaLabel =
            secondaryH !== null
              ? `${s.label}: ${secondaryLabel ?? "secondary"} ${formatPoints(s.secondary as number)}, ${primaryLabel} ${formatPoints(s.primary)}`
              : `${s.label}: ${primaryLabel} ${formatPoints(s.primary)}`;

          return (
            <div
              key={`${s.label}-${i}`}
              className="flex flex-col items-center gap-1 flex-shrink-0"
              style={{ minWidth: "48px" }}
              aria-label={barAriaLabel}
            >
              {/* Bar(s) — secondary (lighter/outlined) sits beside primary, like the velocity chart */}
              <div className="flex items-end gap-0.5" style={{ height: `${BAR_MAX_HEIGHT}px` }}>
                {secondaryH !== null && (
                  <div
                    className="w-5 rounded-t bg-muted border border-border transition-all"
                    style={{ height: `${secondaryH}px` }}
                    title={`${secondaryLabel ?? "Secondary"}: ${formatPoints(s.secondary as number)}`}
                  />
                )}
                <div
                  className="w-5 rounded-t bg-[hsl(var(--status-done))] transition-all"
                  style={{ height: `${primaryH}px` }}
                  title={`${primaryLabel}: ${formatPoints(s.primary)}`}
                />
              </div>
              {/* Category label */}
              <p
                className="text-[0.6rem] text-muted-foreground text-center leading-tight max-w-[48px] truncate"
                title={s.label}
              >
                {s.label}
              </p>
            </div>
          );
        })}
      </div>
    </figure>
  );
}
