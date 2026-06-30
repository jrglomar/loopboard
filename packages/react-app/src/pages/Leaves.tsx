// Leaves & offset page (v1.26, ADR-038; forward multi-sprint planner v1.29, ADR-041).
// Plot typed leaves (VL/EL/Holiday/Offset) across a forward, multi-sprint calendar and track
// per-developer offset points (auto earned/spent + a manual adjustment). Board-scoped (shared context).

import { useState, useMemo } from "react";
import { CalendarDays, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BoardToggle } from "../components/BoardToggle";
import { LeavesPlannerCard } from "../components/LeavesPlannerCard";
import { useBoards, usePolicy } from "../lib/boards";
import {
  useSprintList,
  useSprintReport,
  useTeamMembers,
  useAllLeaves,
  useOffsetLedger,
} from "../hooks/useJira";
import { sprintWorkingDays } from "../lib/capacity";
import { leaveDaysByType, totalLeaveDays, computeOffsetEarned, LEAVE_TYPES } from "../lib/offset";
import type { BoardKey, SharedSprintProps, LeaveType, SprintRef } from "../lib/types";
import { cn } from "@/lib/utils";

const PAINT_STYLE: Record<LeaveType, string> = {
  VL: "bg-[hsl(var(--info-bg))] text-[hsl(var(--info))]",
  EL: "bg-[hsl(var(--error-bg))] text-[hsl(var(--error))]",
  Holiday: "bg-[hsl(var(--success-bg))] text-[hsl(var(--success))]",
  Offset: "bg-[hsl(var(--accent)/0.12)] text-[hsl(var(--accent))]",
};
const PAINT_LABEL: Record<LeaveType, string> = {
  VL: "Vacation", EL: "Emergency", Holiday: "Holiday", Offset: "Offset",
};

export function Leaves({
  boardKey: boardKeyProp,
  sprintId: sprintIdProp,
  onBoardChange,
  onSprintChange,
  projectIdx,
}: SharedSprintProps = {}) {
  const { boards, loading: boardsLoading } = useBoards();
  const policy = usePolicy();

  const [localBoardKey, setLocalBoardKey] = useState<BoardKey>("dev");
  const selectedBoardKey = boardKeyProp ?? localBoardKey;
  const activeProjectIdx = projectIdx ?? 0;
  const selectedBoardId: number | undefined = boards
    ? boards[selectedBoardKey][activeProjectIdx]?.id
    : undefined;

  const handleBoardChange = (key: BoardKey) => {
    if (onBoardChange) onBoardChange(key); else setLocalBoardKey(key);
  };

  // Sprint list (all states) for the board + the selected sprint.
  const sprintList = useSprintList("all", selectedBoardId);
  const allSprints: SprintRef[] = useMemo(() => {
    const d = sprintList.data;
    return d ? [...d.active, ...d.future, ...d.closed] : [];
  }, [sprintList.data]);

  const [localSprintId, setLocalSprintId] = useState<number | null>(null);
  const controlledSprint = onSprintChange ? (sprintIdProp ?? null) : null;
  // default to the first active sprint when nothing is picked yet
  const defaultSprintId = sprintList.data?.active[0]?.id ?? allSprints[0]?.id ?? null;
  const selectedSprintId = controlledSprint ?? localSprintId ?? defaultSprintId;
  const selectedSprint = allSprints.find((s) => s.id === selectedSprintId) ?? null;

  const setSprint = (id: number) => {
    if (onSprintChange) onSprintChange(id); else setLocalSprintId(id);
  };

  // Data for the selected sprint.
  const team = useTeamMembers(selectedBoardId ?? null);
  const report = useSprintReport(selectedSprintId, selectedBoardId);
  // v1.29 (ADR-041): the WHOLE leaves store powers the multi-sprint planner; the offset table
  // below reads only the selected sprint's slice out of it.
  const allLeaves = useAllLeaves();
  const ledger = useOffsetLedger();

  const [paintType, setPaintType] = useState<LeaveType>("VL");
  const [recording, setRecording] = useState(false);

  const roster = useMemo(() => (team.data ?? []).map((m) => m.displayName), [team.data]);
  const workingDays = useMemo(
    () => sprintWorkingDays(selectedSprint?.startDate, selectedSprint?.endDate),
    [selectedSprint?.startDate, selectedSprint?.endDate]
  );

  // v1.29 (revised per feedback): the planner shows ONLY the selected sprint. Switch to any
  // sprint — including a FUTURE one — via the grouped picker above to plot leaves there.
  const windowSprints = useMemo(() => (selectedSprint ? [selectedSprint] : []), [selectedSprint]);
  // The selected sprint's leaves (for the offset table) out of the whole store.
  const selectedLeaves = selectedSprintId !== null ? (allLeaves.data[String(selectedSprintId)] ?? {}) : {};

  // Per-developer offset rows (this sprint + the persisted ledger balance).
  const rows = useMemo(() => {
    const byAssignee = report.data?.byAssignee ?? [];
    const donePts = (name: string) => byAssignee.find((a) => a.name === name)?.donePoints ?? 0;
    return roster.map((name) => {
      const typed = selectedLeaves[name] ?? {};
      const byType = leaveDaysByType(typed, workingDays);
      const leaveDays = totalLeaveDays(typed, workingDays);
      const done = donePts(name);
      const earnedThisSprint = computeOffsetEarned(done, leaveDays, policy.requiredPoints, policy.offsetThreshold);
      const spentThisSprint = byType.Offset;
      const standing = ledger.data?.[name];
      return {
        name, done, byType, leaveDays, total: done + leaveDays,
        earnedThisSprint, spentThisSprint,
        balance: standing?.balance ?? 0,
        manualAdjust: standing?.manualAdjust ?? 0,
      };
    });
  }, [roster, report.data, allLeaves.data, selectedSprintId, workingDays, policy, ledger.data]); // eslint-disable-line react-hooks/exhaustive-deps

  async function recordSprint() {
    if (selectedSprintId === null) return;
    setRecording(true);
    try {
      await ledger.recordSprint(
        selectedSprintId,
        rows.map((r) => ({ assignee: r.name, earned: r.earnedThisSprint, spent: r.spentThisSprint }))
      );
    } catch { /* surfaced via ledger.error on refresh */ } finally { setRecording(false); }
  }

  return (
    <div className="space-y-4">
      {/* Header + context */}
      <div className="flex items-center gap-3 flex-wrap">
        <CalendarDays className="h-6 w-6 text-primary" aria-hidden="true" />
        <h1 className="text-xl font-semibold text-foreground">Leaves &amp; offset</h1>
        {!onBoardChange && !boardsLoading && boards !== null && (
          <BoardToggle selectedKey={selectedBoardKey} onChange={handleBoardChange} />
        )}
        {/* Sprint picker — grouped by state so FUTURE sprints are easy to pick (plot ahead) */}
        {sprintList.data && allSprints.length > 0 && (
          <select
            aria-label="Sprint"
            value={selectedSprintId ?? ""}
            onChange={(e) => setSprint(Number(e.target.value))}
            className="h-9 rounded-md border border-border bg-card px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {(["future", "active", "closed"] as const).map((g) =>
              sprintList.data![g].length > 0 ? (
                <optgroup key={g} label={g[0]!.toUpperCase() + g.slice(1)}>
                  {sprintList.data![g].map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </optgroup>
              ) : null
            )}
          </select>
        )}
        <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <span className="bg-muted rounded px-2 py-1">Required N <b className="font-medium text-foreground">{policy.requiredPoints}</b></span>
          <span className="bg-muted rounded px-2 py-1">Offset step N2 <b className="font-medium text-foreground">{policy.offsetThreshold}</b></span>
        </span>
      </div>

      {/* Leave-type painter */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-muted-foreground">Plot type:</span>
        {LEAVE_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setPaintType(t)}
            aria-pressed={paintType === t}
            className={cn(
              "text-xs font-medium px-3 py-1.5 rounded-md transition-shadow",
              PAINT_STYLE[t],
              paintType === t ? "ring-2 ring-offset-1 ring-current" : "opacity-80 hover:opacity-100"
            )}
          >
            {PAINT_LABEL[t]}
          </button>
        ))}
        <span className="text-xs text-muted-foreground ml-auto">Click a day to paint the selected type. The sprint picker scopes the offset table below.</span>
      </div>

      {/* v1.29 (ADR-041): forward, multi-sprint leave planner — each day saves to its own sprint */}
      <LeavesPlannerCard
        sprints={windowSprints}
        roster={roster}
        leavesBySprint={allLeaves.data}
        paintType={paintType}
        onPlot={allLeaves.save}
        loading={allLeaves.loading}
      />

      {/* Offset table */}
      <Card className="shadow-sm">
        <CardHeader className="px-4 pt-3 pb-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-foreground">Offset points</h3>
            <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => void recordSprint()} disabled={recording || selectedSprintId === null}>
              <RefreshCw className="h-4 w-4 mr-1.5" aria-hidden="true" />
              {recording ? "Recording…" : "Record this sprint"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-3 pt-0 overflow-x-auto">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No team members yet — add them in Planning → Manage team.</p>
          ) : (
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
                  <th className="text-left font-medium py-1.5">Developer</th>
                  <th className="text-right font-medium px-2">Done</th>
                  <th className="text-right font-medium px-2">VL</th>
                  <th className="text-right font-medium px-2">EL</th>
                  <th className="text-right font-medium px-2">HO</th>
                  <th className="text-right font-medium px-2">OF</th>
                  <th className="text-right font-medium px-2">Total</th>
                  <th className="text-right font-medium px-2">Earned</th>
                  <th className="text-right font-medium px-2">Manual</th>
                  <th className="text-right font-medium px-2">Balance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name} className="border-t border-border/50 tabular-nums">
                    <td className="py-1.5 text-foreground font-medium">{r.name}</td>
                    <td className="text-right px-2">{r.done}</td>
                    <td className="text-right px-2 text-muted-foreground">{r.byType.VL || "—"}</td>
                    <td className="text-right px-2 text-muted-foreground">{r.byType.EL || "—"}</td>
                    <td className="text-right px-2 text-muted-foreground">{r.byType.Holiday || "—"}</td>
                    <td className="text-right px-2 text-muted-foreground">{r.byType.Offset || "—"}</td>
                    <td className="text-right px-2 font-medium">{r.total}</td>
                    <td className={cn("text-right px-2 font-medium", r.earnedThisSprint > 0 && "text-success")}>
                      {r.earnedThisSprint > 0 ? `+${r.earnedThisSprint}` : "0"}
                    </td>
                    <td className="text-right px-2">
                      <label className="sr-only" htmlFor={`adj-${r.name}`}>Manual adjustment for {r.name}</label>
                      <Input
                        id={`adj-${r.name}`}
                        type="number"
                        defaultValue={r.manualAdjust}
                        onBlur={(e) => {
                          const v = Math.trunc(Number(e.target.value) || 0);
                          if (v !== r.manualAdjust) void ledger.adjust(r.name, v);
                        }}
                        className="h-7 w-16 text-right ml-auto"
                        aria-label={`Manual adjustment for ${r.name}`}
                      />
                    </td>
                    <td className="text-right px-2 font-semibold text-primary">{r.balance}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-[0.6875rem] text-muted-foreground">
            Earned = (done + leave days) ≥ N + N2 ? 1 : 0 (max 1 / sprint). Balance = Σ earned − Σ Offset leaves + manual.
            "Record this sprint" saves the current sprint's earned/spent into the ledger.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
