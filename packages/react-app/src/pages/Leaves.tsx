// Leaves & offset page (v1.26, ADR-038; forward multi-sprint planner v1.29, ADR-041).
// Plot typed leaves (VL/EL/Holiday/Offset) across a forward, multi-sprint calendar and track
// per-developer offset points. v1.50 (ADR-061): earned offsets are BANKED on confirm (a button +
// dialog), not automatically on view; the manual field is the developer's "opening balance".
// Board-scoped (shared context).

import { useState, useMemo } from "react";
import { CalendarDays, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { BoardToggle } from "../components/BoardToggle";
import { LeavesPlannerCard } from "../components/LeavesPlannerCard";
import { OffsetWalletCard } from "../components/OffsetWalletCard";
import { OffsetHistoryDialog } from "../components/OffsetHistoryDialog";
import { BankOffsetsDialog, type BankRow } from "../components/BankOffsetsDialog";
import { useBoards, usePolicy } from "../lib/boards";
import {
  useSprintList,
  useSprintReport,
  useTeamMembers,
  useAllLeaves,
  useOffsetLedger,
} from "../hooks/useJira";
import { LeaveTypePicker } from "../components/LeaveTypePicker";
import { sprintWorkingDays } from "../lib/capacity";
import { leaveDaysByType, totalLeaveDays, computeOffsetEarned } from "../lib/offset";
import { computeOffsetWallet, buildOffsetHistory } from "../lib/offsetWallet";
import { formatPoints } from "../lib/format";
import type { BoardKey, SharedSprintProps, LeaveType, SprintRef } from "../lib/types";
import { cn } from "@/lib/utils";

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
  // v1.33 (ADR-044): the developer whose offset history modal is open (null = closed).
  const [historyFor, setHistoryFor] = useState<string | null>(null);

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

  // v1.33 (ADR-044): the offset WALLET — earned banks per sprint; spend is derived LIVE from Offset
  // leaves; balance = earned − used + manual. Recomputes whenever the ledger or the leaves change.
  const wallet = useMemo(
    () => computeOffsetWallet(ledger.data, allLeaves.data),
    [ledger.data, allLeaves.data]
  );

  // v1.33 (ADR-044, Phase 2): sprint id → name for the history modal's usage labels.
  const sprintNameById = useMemo(
    () => Object.fromEntries(allSprints.map((s) => [String(s.id), s.name])),
    [allSprints]
  );
  const history = historyFor
    ? buildOffsetHistory(historyFor, ledger.data, allLeaves.data, sprintNameById)
    : null;

  // v1.50 (ADR-061): banking earned offsets is a deliberate, confirmed action (was auto-on-view).
  // Build the per-developer rows for the confirm dialog: computed earned + what's already banked.
  const [bankOpen, setBankOpen] = useState(false);
  const bankRows: BankRow[] = useMemo(
    () =>
      rows.map((r) => ({
        name: r.name,
        earned: r.earnedThisSprint,
        banked:
          selectedSprintId !== null
            ? (ledger.data?.[r.name]?.bySprint?.[String(selectedSprintId)]?.earned ?? null)
            : null,
      })),
    [rows, ledger.data, selectedSprintId]
  );
  const canBank = selectedSprintId !== null && !!report.data && rows.length > 0;
  // True when every developer's computed earned already matches what's banked for this sprint.
  const allBanked = bankRows.every((r) => r.earned === (r.banked ?? 0));

  async function bankSprint() {
    if (selectedSprintId === null) return;
    await ledger.recordSprint(
      selectedSprintId,
      rows.map((r) => ({ assignee: r.name, earned: r.earnedThisSprint, spent: 0 }))
    );
  }

  return (
    <div className="space-y-4">
      {/* Header + context */}
      <div className="flex items-center gap-3 flex-wrap">
        <CalendarDays className="h-6 w-6 text-primary" aria-hidden="true" />
        <h1 className="text-xl font-semibold text-foreground">Offset Tracker</h1>
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

      {/* v1.33 (ADR-044): main offset wallet — per-developer balance, auto add (earned) / deduct (Offset leaves) */}
      <OffsetWalletCard wallet={wallet} roster={roster} onHistory={setHistoryFor} />

      {/* Leave-type painter — v1.39: shared LeaveTypePicker (also used by Planning's calendar) */}
      <LeaveTypePicker
        value={paintType}
        onChange={setPaintType}
        hint="Click a day to paint the selected type. The sprint picker scopes the offset table below."
      />

      {/* v1.29 (ADR-041): forward, multi-sprint leave planner — each day saves to its own sprint */}
      <LeavesPlannerCard
        sprints={windowSprints}
        roster={roster}
        leavesBySprint={allLeaves.data}
        paintType={paintType}
        onPlot={allLeaves.save}
        loading={allLeaves.loading}
      />

      {/* Offset table — w-fit: the card hugs the table instead of leaving white space (v1.39) */}
      <Card className="shadow-sm">
        <CardHeader className="px-4 pt-3 pb-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-foreground">
              Offset points — this sprint
              <span className="ml-2 text-xs font-normal text-muted-foreground">review, then bank earned into the wallet</span>
            </h3>
            {/* v1.50 (ADR-061): banking is a confirmed action, not automatic */}
            <Button
              type="button" size="sm" variant={allBanked ? "outline" : "default"} className="ml-auto"
              disabled={!canBank}
              onClick={() => setBankOpen(true)}
            >
              <Wallet className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
              {allBanked ? "Banked ✓" : "Bank earned offsets"}
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
                  <th className="text-right font-medium px-2">Opening</th>
                  <th className="text-right font-medium px-2">Balance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name} className="border-t border-border/50 tabular-nums">
                    <td className="py-1.5 text-foreground font-medium">{r.name}</td>
                    <td className="text-right px-2">{formatPoints(r.done)}</td>
                    <td className="text-right px-2 text-muted-foreground">{r.byType.VL || "—"}</td>
                    <td className="text-right px-2 text-muted-foreground">{r.byType.EL || "—"}</td>
                    <td className="text-right px-2 text-muted-foreground">{r.byType.Holiday || "—"}</td>
                    <td className="text-right px-2 text-muted-foreground">{r.byType.Offset || "—"}</td>
                    <td className="text-right px-2 font-medium">{formatPoints(r.total)}</td>
                    <td className={cn("text-right px-2 font-medium", r.earnedThisSprint > 0 && "text-success")}>
                      {r.earnedThisSprint > 0 ? `+${formatPoints(r.earnedThisSprint)}` : "0"}
                    </td>
                    <td className="text-right px-2">
                      <label className="sr-only" htmlFor={`adj-${r.name}`}>Opening balance for {r.name}</label>
                      <Input
                        id={`adj-${r.name}`}
                        type="number"
                        step="0.5"
                        defaultValue={r.manualAdjust}
                        onBlur={(e) => {
                          // v1.55 (ADR-066): decimals allowed (e.g. 0.5); round to 2 dp to keep the store tidy.
                          const v = Math.round((Number(e.target.value) || 0) * 100) / 100;
                          if (v !== r.manualAdjust) void ledger.adjust(r.name, v);
                        }}
                        className="h-7 w-16 text-right ml-auto"
                        aria-label={`Opening balance for ${r.name}`}
                      />
                    </td>
                    <td className="text-right px-2 font-semibold text-primary tabular-nums">{formatPoints(wallet[r.name]?.balance ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-[0.6875rem] text-muted-foreground">
            Earned = (done + leave days) ≥ N + N2 ? 1 : 0 (max 1 / sprint) — click <b className="font-medium text-foreground">Bank earned offsets</b> to add it to the wallet.
            <br />
            <b className="font-medium text-foreground">Opening</b> is each developer's prior/carry-in balance — set it so the wallet total matches. Balance = Σ banked earned − Σ Offset leaves plotted + opening.
          </p>
        </CardContent>
      </Card>

      {/* v1.50 (ADR-061): confirm banking the sprint's earned offsets into the wallet */}
      <BankOffsetsDialog
        open={bankOpen}
        onOpenChange={setBankOpen}
        sprintName={selectedSprint?.name ?? "this sprint"}
        rows={bankRows}
        onConfirm={bankSprint}
      />

      {/* v1.33 (ADR-044, Phase 2): per-developer offset history. v1.54 (ADR-065): earned + used + a
          manual-adjustment log you can add to / remove from, all in this dialog. */}
      <OffsetHistoryDialog
        assignee={historyFor}
        history={history}
        open={historyFor !== null}
        onOpenChange={(o) => { if (!o) setHistoryFor(null); }}
        onAddAdjustment={ledger.addAdjustment}
        onDeleteAdjustment={ledger.deleteAdjustment}
      />
    </div>
  );
}
