// SprintRangePicker — sprint-window selection UI for Trends & KPIs (v1.59, ADR-071).
// Fully props-driven / controlled: TrendsView owns all state, this renders it and fires
// callbacks. The 3-mode segmented control mirrors Reports.tsx's board toggle exactly
// (role="group" + per-button aria-pressed).

import { CalendarRange } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MAX_SPRINT_WINDOW } from "../../lib/sprintRange";
import type { SprintRef } from "../../lib/types";

export type TrendsSelectionMode = "recent" | "pick" | "range";

const MODES: Array<{ key: TrendsSelectionMode; label: string }> = [
  { key: "recent", label: "Last N" },
  { key: "pick", label: "Pick sprints" },
  { key: "range", label: "Date range" },
];

export interface SprintRangePickerProps {
  mode: TrendsSelectionMode;
  onModeChange: (mode: TrendsSelectionMode) => void;

  /** "recent" mode — default 10, min 1 max 26 (mirrors get_multi_sprint_report's sprintCount). */
  lastN: number;
  onLastNChange: (n: number) => void;

  /** "pick" mode — the board's sprints, grouped Active/Closed. */
  active: SprintRef[];
  closed: SprintRef[];
  pickedIds: number[];
  onTogglePicked: (id: number) => void;

  /** "range" mode — native date inputs, "" = unset. */
  rangeStart: string;
  rangeEnd: string;
  onRangeStartChange: (value: string) => void;
  onRangeEndChange: (value: string) => void;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

function SprintCheckbox({
  sprint,
  checked,
  disabled,
  onToggle,
}: {
  sprint: SprintRef;
  checked: boolean;
  /** v1.61 (ADR-073, item 175) — true once MAX_SPRINT_WINDOW are picked AND this one isn't
   *  already one of them; lets the user uncheck an existing pick but not add past the cap. */
  disabled: boolean;
  onToggle: () => void;
}) {
  const inputId = `trends-pick-${sprint.id}`;
  return (
    <li className="flex items-center gap-2 py-1">
      <input
        id={inputId}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
        className="h-4 w-4 rounded border-input disabled:opacity-40 disabled:cursor-not-allowed"
      />
      <label
        htmlFor={inputId}
        className={`text-sm flex-1 ${disabled ? "text-muted-foreground cursor-not-allowed" : "text-foreground cursor-pointer"}`}
      >
        {sprint.name}{" "}
        <span className="text-xs text-muted-foreground">
          ({formatDate(sprint.startDate)} – {formatDate(sprint.endDate)})
        </span>
      </label>
    </li>
  );
}

export function SprintRangePicker({
  mode,
  onModeChange,
  lastN,
  onLastNChange,
  active,
  closed,
  pickedIds,
  onTogglePicked,
  rangeStart,
  rangeEnd,
  onRangeStartChange,
  onRangeEndChange,
}: SprintRangePickerProps) {
  const pickedSet = new Set(pickedIds);
  // v1.61 (ADR-073, item 175): get_multi_sprint_report rejects sprintIds arrays over
  // MAX_SPRINT_WINDOW (26, §4.29) — once that many are picked, block adding more (but never
  // block unchecking an existing pick, so the user can always swap one out).
  const atMax = pickedIds.length >= MAX_SPRINT_WINDOW;

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
            <CalendarRange className="h-4 w-4 text-primary" aria-hidden="true" />
            Sprint window
          </h3>
          {/* a11y: role="group" + aria-pressed — same segmented-control pattern as the board toggle */}
          <div
            role="group"
            aria-label="Sprint selection mode"
            className="flex items-center gap-1 rounded-md border border-border bg-muted p-0.5"
          >
            {MODES.map(({ key, label }) => {
              const pressed = mode === key;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => onModeChange(key)}
                  className={`
                    px-3 py-1 rounded-sm text-xs font-semibold transition-colors
                    ${pressed
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-background/60"}
                  `}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {mode === "recent" && (
          <div className="flex flex-col gap-1 max-w-[200px]">
            <Label
              htmlFor="trends-last-n"
              className="text-xs font-medium text-muted-foreground uppercase tracking-wide"
            >
              Last N closed sprints
            </Label>
            <Input
              id="trends-last-n"
              type="number"
              min={1}
              max={26}
              value={lastN}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) onLastNChange(n);
              }}
            />
          </div>
        )}

        {mode === "pick" && (
          <div>
            {/* a11y: role="group" + a visible label — the (max 26) hint sits right beside it,
                v1.61 (ADR-073, item 175). Scoped to the FULL picked set (Active + Closed
                combined), not per-column. */}
            <div className="flex items-center gap-1.5 mb-2">
              <p
                id="trends-pick-group-label"
                className="text-xs font-medium text-muted-foreground uppercase tracking-wide"
              >
                Select sprints
              </p>
              <span className="text-xs text-muted-foreground normal-case">(max 26)</span>
            </div>
            <div
              role="group"
              aria-labelledby="trends-pick-group-label"
              className="grid grid-cols-1 sm:grid-cols-2 gap-4"
            >
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                  Active
                </p>
                {active.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No active sprints.</p>
                ) : (
                  <ul className="space-y-0.5" style={{ listStyle: "none" }}>
                    {active.map((s) => (
                      <SprintCheckbox
                        key={s.id}
                        sprint={s}
                        checked={pickedSet.has(s.id)}
                        disabled={atMax && !pickedSet.has(s.id)}
                        onToggle={() => onTogglePicked(s.id)}
                      />
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                  Closed
                </p>
                {closed.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No closed sprints.</p>
                ) : (
                  <ul className="space-y-0.5" style={{ listStyle: "none" }}>
                    {closed.map((s) => (
                      <SprintCheckbox
                        key={s.id}
                        sprint={s}
                        checked={pickedSet.has(s.id)}
                        disabled={atMax && !pickedSet.has(s.id)}
                        onToggle={() => onTogglePicked(s.id)}
                      />
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}

        {mode === "range" && (
          <div className="flex flex-wrap gap-4">
            <div className="flex flex-col gap-1">
              <Label
                htmlFor="trends-range-start"
                className="text-xs font-medium text-muted-foreground uppercase tracking-wide"
              >
                From
              </Label>
              <Input
                id="trends-range-start"
                type="date"
                value={rangeStart}
                onChange={(e) => onRangeStartChange(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label
                htmlFor="trends-range-end"
                className="text-xs font-medium text-muted-foreground uppercase tracking-wide"
              >
                To
              </Label>
              <Input
                id="trends-range-end"
                type="date"
                value={rangeEnd}
                onChange={(e) => onRangeEndChange(e.target.value)}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
