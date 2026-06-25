// Planning — Sprint Preparation / Grooming workspace (v1.8, ADR-019)
//
// This page consolidates all sprint-prep actions:
//   1. Board + sprint context picker (default: next future sprint)
//   2. Team manager (v1.8) — curated per-board roster (Manage team button)
//   3. New Sprint (CreateSprintDialog, moved off Dashboard)
//   4. Ticket generation (TicketGen component, pre-seeded to planned sprint)
//   5. Leaves / capacity plotter (v1.8: rostered from team, not assignable users)
//   6. Assign tickets to developers (v1.8: roster from team + assigneeAccountId pre-select)
//
// Layout: sprint context header (with TeamManager) → new sprint → ticket gen
//         → leaves slot → assignment slot

import { useState, useEffect, useId, useCallback } from "react";
import { LayoutGrid, CalendarDays, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { BoardToggle } from "../components/BoardToggle";
import { CreateSprintDialog } from "../components/CreateSprintDialog";
import { LeavesPlotterCard } from "../components/LeavesPlotterCard";
import { AssignmentList } from "../components/AssignmentList";
import { TeamManager } from "../components/TeamManager";
import { SprintGoalEditor } from "../components/SprintGoalEditor";
import { TicketGen } from "./TicketGen";
import { useBoards } from "../lib/boards";
import { useSprintList } from "../hooks/useJira";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { BoardKey, SprintRef, SharedSprintProps } from "../lib/types";

// ── Sprint selector ───────────────────────────────────────────────────────────

interface PlanningSprintSelectProps {
  sprintListLoading: boolean;
  active: SprintRef[];
  future: SprintRef[];
  value: number | undefined;
  onChange: (id: number) => void;
  selectId: string;
}

/**
 * Grouped Active / Future sprint select for the planning context.
 * a11y: native <select> — consistent with ADR-009.
 */
function PlanningSprintSelect({
  sprintListLoading,
  active,
  future,
  value,
  onChange,
  selectId,
}: PlanningSprintSelectProps) {
  const hasOptions = active.length + future.length > 0;

  return (
    <select
      id={selectId}
      className="h-9 w-full max-w-xs text-xs px-2 border border-border rounded-md bg-background text-foreground font-[inherit] cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 transition-colors hover:border-ring disabled:opacity-50 disabled:cursor-not-allowed"
      value={value ?? ""}
      onChange={(e) => {
        const v = e.target.value;
        if (v !== "") onChange(parseInt(v, 10));
      }}
      disabled={sprintListLoading || !hasOptions}
      aria-label="Planning target sprint"
    >
      {!hasOptions && !sprintListLoading && (
        <option value="">No sprints available</option>
      )}
      {sprintListLoading && (
        <option value="">Loading sprints…</option>
      )}
      {future.length > 0 && (
        <optgroup label="Future">
          {future.map((s) => (
            <option key={s.id} value={s.id} title={s.name}>
              {s.name}
            </option>
          ))}
        </optgroup>
      )}
      {active.length > 0 && (
        <optgroup label="Active">
          {active.map((s) => (
            <option key={s.id} value={s.id} title={s.name}>
              {s.name}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

// ── Planning page ─────────────────────────────────────────────────────────────

// a11y: main landmark is provided by the App shell; Planning occupies the slot.
// v1.13 (ADR-024): controlled by App's shared board+sprint when props present.
export function Planning({
  boardKey: boardKeyProp,
  sprintId: sprintIdProp,
  onBoardChange,
  onSprintChange,
}: SharedSprintProps = {}) {
  const selectId = useId();

  // ── Board context ────────────────────────────────────────────────────────

  const { boards, loading: boardsLoading } = useBoards();

  // Default board = Dev (ADR-018); shared when controlled.
  const [localBoardKey, setLocalBoardKey] = useState<BoardKey>("dev");
  const selectedBoardKey = boardKeyProp ?? localBoardKey;

  // Resolved numeric board id; undefined until boards loads (tools use server default)
  const selectedBoardId: number | undefined =
    boards !== null ? boards[selectedBoardKey].id : undefined;

  // projectKey for the current board — passed to FRONTEND-2 slots (ADR-018)
  // perf: derived from already-loaded boards; no extra fetch
  const selectedProjectKey: string | undefined =
    boards !== null ? boards[selectedBoardKey].projectKey : undefined;
  // selectedProjectKey is used by the FRONTEND-2 component slots below

  // ── Sprint list for the selected board ──────────────────────────────────

  // perf: useSprintList fires once on mount and when boardId changes; state="all"
  // returns active + future + closed; we only use active + future here.
  const sprintList = useSprintList("all", selectedBoardId);

  // ── Planning target sprint (default = next future sprint) ────────────────

  // localSprintId holds the page DEFAULT (set by the effect below) + uncontrolled picks.
  const [localSprintId, setLocalSprintId] = useState<number | undefined>(undefined);
  // Effective sprint (v1.13): an explicit shared pick (controlled) overrides the page default.
  const selectedSprintId: number | undefined =
    onSprintChange && (sprintIdProp ?? undefined) !== undefined
      ? (sprintIdProp ?? undefined)
      : localSprintId;
  // Explicit user picks route to App when controlled, else to local state.
  const setSprintSelection = (id: number) => {
    if (onSprintChange) onSprintChange(id);
    else setLocalSprintId(id);
  };

  // The full SprintRef for the selected sprint (needed for FRONTEND-2 slots)
  const activeSprints: SprintRef[] = sprintList.data?.active ?? [];
  const futureSprints: SprintRef[] = sprintList.data?.future ?? [];

  const selectedSprint: SprintRef | undefined =
    selectedSprintId !== undefined
      ? [...futureSprints, ...activeSprints].find(
          (s) => s.id === selectedSprintId
        )
      : undefined;

  /**
   * Default selection rule (ADR-018):
   * - First future sprint (next-up first, sorted by earliest startDate)
   * - If no future sprints, fall back to the first active sprint (latest-started)
   * Re-run when the board changes or when the sprint list loads.
   */
  useEffect(() => {
    if (sprintList.loading) return;
    const future = sprintList.data?.future ?? [];
    const active = sprintList.data?.active ?? [];
    const defaultSprint = future[0] ?? active[0];
    // v1.13: write the DEFAULT to local state only (never to the shared pick).
    setLocalSprintId(defaultSprint !== undefined ? defaultSprint.id : undefined);
    // Re-default when board changes (selectedBoardId is the stable dep here)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBoardId, sprintList.loading, sprintList.data]);

  // ── Board change handler ─────────────────────────────────────────────────

  const handleBoardChange = (key: BoardKey) => {
    if (onBoardChange) onBoardChange(key);
    else setLocalBoardKey(key);
    // Sprint selection re-defaults via the useEffect above once sprint list reloads
    setLocalSprintId(undefined);
  };

  // ── Team change handler (v1.8) ───────────────────────────────────────────
  // perf: a lightweight counter lets the two cards' useTeamMembers hooks re-run
  // after a team edit. Both cards hold their own useTeamMembers(boardId) call,
  // which auto-fetches on boardId change. The simplest sync mechanism is to
  // pass a `key` or increment a counter that remounts them — but remounting
  // would discard leaves UI state. Instead we increment a shared revision counter
  // that both cards receive as a prop no-op (they ignore it) — and because the
  // cards' own hooks auto-fetch on boardId change, we force a re-run by
  // temporarily nulling and restoring boardId. Simpler: just use a callback
  // that calls the cards' run() via a forwarded ref. Simplest of all: lift
  // useTeamMembers to Planning and pass `team` + `teamRun` down. We do that.
  //
  // (The cards also call useTeamMembers internally for their own state, but we
  //  pass a `teamRevision` counter that changes after each save so they refetch.)
  const [teamRevision, setTeamRevision] = useState(0);
  const handleTeamChange = useCallback(() => {
    setTeamRevision((r) => r + 1);
  }, []);

  // v1.17 (ADR-028): the ticket generator now lives in a drawer (PO-first).
  const [ticketDrawerOpen, setTicketDrawerOpen] = useState(false);

  // ── New Sprint created ────────────────────────────────────────────────────

  const handleSprintCreated = (newSprint: SprintRef) => {
    // Select the new sprint as the planning target (explicit pick) and refetch.
    setSprintSelection(newSprint.id);
    sprintList.run();
  };

  // ── TicketGen pre-seed props (ADR-018) ───────────────────────────────────
  // When planning the Dev board, pre-seed the Dev sprint select in TicketGen.
  // When planning the PO board, pre-seed the PO sprint select.
  const ticketGenInitialPoSprintId =
    selectedBoardKey === "po" ? selectedSprintId : undefined;
  const ticketGenInitialDevSprintId =
    selectedBoardKey === "dev" ? selectedSprintId : undefined;

  // ── Derived display info ─────────────────────────────────────────────────

  const boardLabel = selectedBoardKey === "dev" ? "Dev" : "PO";

  const isNoSprintError =
    sprintList.error !== null &&
    (sprintList.error.code === "UPSTREAM" ||
      sprintList.error.message?.toLowerCase().includes("no active or future sprint"));

  const sprintState = selectedSprint?.state;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">

      {/* ── Section 1: Sprint context header ───────────────────────────────── */}
      <section aria-label="Planning context" className="min-w-0">
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              {/* a11y: icon is decorative */}
              <LayoutGrid className="h-4 w-4 text-primary" aria-hidden="true" />
              <h2 className="text-lg font-semibold">Sprint Preparation</h2>
              {sprintState === "future" && (
                <Badge
                  variant="outline"
                  className="text-[0.6875rem] font-semibold border-primary/40 text-primary bg-primary/10"
                >
                  Future sprint
                </Badge>
              )}
              {sprintState === "active" && (
                <Badge
                  variant="outline"
                  className="text-[0.6875rem] font-semibold border-success-border text-success bg-success-bg"
                >
                  Active sprint
                </Badge>
              )}
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            {/* Board + sprint context row */}
            <div className="flex items-end gap-4 flex-wrap">

              {/* Board toggle */}
              <div className="space-y-1.5">
                {/* a11y: visual label above the toggle */}
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Board
                </p>
                {!boardsLoading && boards !== null ? (
                  <BoardToggle
                    selectedKey={selectedBoardKey}
                    onChange={handleBoardChange}
                  />
                ) : boardsLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : null}
              </div>

              {/* v1.8 (ADR-019): Team Manager — curated per-board roster */}
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Team
                </p>
                <TeamManager
                  boardId={selectedBoardId}
                  onTeamChange={handleTeamChange}
                />
              </div>

              {/* Sprint picker */}
              <div className="space-y-1.5 flex-1 min-w-[200px] max-w-xs">
                <label
                  htmlFor={`${selectId}-sprint`}
                  className="text-xs font-semibold text-muted-foreground uppercase tracking-wide"
                >
                  Planning target
                </label>

                {isNoSprintError ? (
                  <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                    No sprints on the {boardLabel} board —{" "}
                    <span className="font-medium text-foreground">
                      create one below
                    </span>
                  </div>
                ) : (
                  <PlanningSprintSelect
                    sprintListLoading={sprintList.loading}
                    active={activeSprints}
                    future={futureSprints}
                    value={selectedSprintId}
                    onChange={setSprintSelection}
                    selectId={`${selectId}-sprint`}
                  />
                )}
              </div>

              {/* Sprint date range summary */}
              {selectedSprint?.startDate && selectedSprint?.endDate && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground self-end pb-1">
                  <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>
                    {selectedSprint.startDate.slice(0, 10)}
                    {" – "}
                    {selectedSprint.endDate.slice(0, 10)}
                  </span>
                </div>
              )}

              {/* New Sprint button — moved from Dashboard (ADR-018) */}
              <div className="self-end">
                {selectedBoardId !== undefined ? (
                  <CreateSprintDialog
                    boardId={selectedBoardId}
                    onSuccess={handleSprintCreated}
                  />
                ) : !boardsLoading ? (
                  // boards not available (older bridge) — still allow creating on server default
                  <CreateSprintDialog
                    onSuccess={handleSprintCreated}
                  />
                ) : null}
              </div>
            </div>

            {/* Sprint goal — editable (v1.13, ADR-024) */}
            {selectedSprintId !== undefined && selectedSprint && (
              <SprintGoalEditor
                sprintId={selectedSprintId}
                goal={selectedSprint.goal}
                onSaved={() => sprintList.run()}
              />
            )}
          </CardContent>
        </Card>
      </section>

      {/* ── Section 2: Ticket generation (moved from Ticket Generator tab) ─── */}
      {/*
        v1.7 (ADR-018): TicketGen is reused here with optional pre-seed props.
        The planned board's sprint is pre-selected in the matching sprint select.
        All TicketGen behavior (AI chat, fallback, two-sprint targets, editable
        drafts, create+success panel) is fully preserved — props are optional so
        TicketGen also works standalone.
      */}
      <section aria-label="Ticket generation" className="min-w-0">
        {/* v1.17 (ADR-028): PO-first ticket generator in a drawer */}
        <Sheet open={ticketDrawerOpen} onOpenChange={setTicketDrawerOpen}>
          <SheetTrigger asChild>
            <Button type="button" variant="outline">
              <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" /> New ticket
            </Button>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>New ticket</SheetTitle>
              <SheetDescription>
                Create a PO story (optionally with a linked Dev task). Bulk PO→Dev lives on the Linking tab.
              </SheetDescription>
            </SheetHeader>
            <TicketGen
              initialPoSprintId={ticketGenInitialPoSprintId}
              initialDevSprintId={ticketGenInitialDevSprintId}
            />
          </SheetContent>
        </Sheet>
      </section>

      {/* (v1.11, ADR-022) — "Dev ticket for an existing PO story" moved to the
          new Linking tab, which generalises it to bulk creation. */}

      {/* ── Section 3: Leaves / capacity plotter (v1.8: team roster) ────────── */}
      {/*
        v1.8 (ADR-019): editable leaves calendar rostered from the curated team
        (useTeamMembers), NOT get_assignable_users. teamRevision triggers a
        re-fetch of the roster when TeamManager saves changes.
      */}
      <section aria-label="Leaves and capacity planning" className="min-w-0">
        <LeavesPlotterCard
          boardId={selectedBoardId}
          sprintId={selectedSprintId}
          sprint={selectedSprint}
          projectKey={selectedProjectKey}
          teamRevision={teamRevision}
        />
      </section>

      {/* ── Section 4: Assign tickets to developers (v1.8: team roster) ──────── */}
      {/*
        v1.8 (ADR-019): roster from curated team; pre-selects current assignee
        by assigneeAccountId; off-team assignees shown as disabled option.
        teamRevision triggers a re-fetch after TeamManager saves.
      */}
      <section aria-label="Ticket assignment" className="min-w-0">
        <AssignmentList
          boardId={selectedBoardId}
          sprintId={selectedSprintId}
          projectKey={selectedProjectKey}
          teamRevision={teamRevision}
          sprints={[...activeSprints, ...futureSprints]}
        />
      </section>
    </div>
  );
}
