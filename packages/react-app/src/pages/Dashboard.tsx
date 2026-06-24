import { useState, useEffect } from "react";
import { Target } from "lucide-react";
import { SprintBoard } from "../components/SprintBoard";
import { HuddleDigest } from "../components/HuddleDigest";
import { ChatPanel } from "../components/ChatPanel";
import { BoardToggle } from "../components/BoardToggle";
import { ImpedimentsCard } from "../components/ImpedimentsCard";
import { PullRequestsCard } from "../components/PullRequestsCard";
import { useActiveSprint, useDailyHuddle } from "../hooks/useJira";
import { getAiStatus } from "../lib/aiClient";
import { useBoards } from "../lib/boards";
import type { AiStatus, BoardKey, SharedSprintProps } from "../lib/types";

// a11y: main landmark is provided by the App shell; Dashboard uses the slot.
// v1.13 (ADR-024): controlled by App's shared board+sprint when props are present;
// uncontrolled (own state) when rendered standalone (e.g. in tests).
export function Dashboard({
  boardKey: boardKeyProp,
  sprintId: sprintIdProp,
  onBoardChange,
  onSprintChange,
}: SharedSprintProps = {}) {
  // v1.6: Board context — load once from health (ADR-017)
  const { boards, loading: boardsLoading } = useBoards();

  // v1.6/v1.13: Selected board key (default = "dev"); shared when controlled.
  const [localBoardKey, setLocalBoardKey] = useState<BoardKey>("dev");
  const selectedBoardKey = boardKeyProp ?? localBoardKey;

  // The numeric board id passed to hooks. Null = not yet loaded → tools use server default (dev)
  const selectedBoardId: number | undefined =
    boards ? boards[selectedBoardKey].id : undefined;

  // v1.1/v1.13: selected sprint. Dashboard's per-ceremony default IS null (the hook
  // then fetches the active sprint), so the shared null works directly.
  const [localSprintId, setLocalSprintId] = useState<number | null>(null);
  const selectedSprintId = onSprintChange ? (sprintIdProp ?? null) : localSprintId;

  // Unified setter — controlled writes to App (numbers only); else local.
  const setSprintSelection = (id: number | null) => {
    if (onSprintChange) { if (id !== null) onSprintChange(id); }
    else setLocalSprintId(id);
  };

  // v1.2: Dashboard owns assigneeFilter (ADR-008); null = All
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatus>({ enabled: false, provider: null, model: null });

  // Fetch AI status once on mount — shared with ChatPanel to avoid duplicate calls
  useEffect(() => {
    getAiStatus().then(setAiStatus).catch(() => {
      // getAiStatus never throws, but be safe
      setAiStatus({ enabled: false, provider: null, model: null });
    });
  }, []);

  const sprint = useActiveSprint(selectedBoardId, selectedSprintId);
  const huddle = useDailyHuddle(selectedBoardId, selectedSprintId);

  // If the loaded data's active+future sprints no longer contain the selection, reset to null
  useEffect(() => {
    if (
      selectedSprintId !== null &&
      sprint.data !== null
    ) {
      const allSelectable = [
        ...sprint.data.activeSprints,
        ...sprint.data.futureSprints,
      ];
      if (!allSelectable.some((s) => s.id === selectedSprintId)) {
        // controlled-null is a no-op (App clears on board change); local resets.
        setSprintSelection(null);
      }
    }
  }, [sprint.data, selectedSprintId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectSprint = (id: number) => {
    // v1.2: reset assignee filter when sprint changes (ADR-008)
    setAssigneeFilter(null);
    setSprintSelection(id);
  };

  // v1.6: Board switch — reset sprint + filter, then refetch
  const handleBoardChange = (key: BoardKey) => {
    if (onBoardChange) onBoardChange(key); else setLocalBoardKey(key);
    setSprintSelection(null); // controlled: App also clears; uncontrolled: clears local
    setAssigneeFilter(null);
    // sprint + huddle auto-refetch when boardId changes (via the hooks' useEffect)
  };

  // v1.6: No-sprint empty state — map UPSTREAM "No active or future sprint" to friendly message
  // (A PO Kanban board returns this error; show empty state, not red error.)
  const isNoSprintError =
    sprint.error !== null &&
    (sprint.error.code === "UPSTREAM" ||
      sprint.error.message?.toLowerCase().includes("no active or future sprint"));

  const boardLabel = selectedBoardKey === "po" ? "PO" : "Dev";

  // v1.16: the impediments + PR cards key off a concrete sprint id. When no explicit
  // pick, fall back to the loaded active sprint's id (null until data arrives).
  const effectiveSprintId = selectedSprintId ?? sprint.data?.sprint.id ?? null;

  return (
    // Two-column layout: board (flex-1) | sidebar (360px) at lg+; stacked below
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5 items-start">

      {/* Sprint board — left / full-width on mobile */}
      <section aria-label="Sprint board" className="min-w-0">
        {/* v1.6: Board toggle header */}
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          {/* a11y: only show the toggle when boards loaded; hidden (not present) during load */}
          {!boardsLoading && boards !== null && (
            <BoardToggle selectedKey={selectedBoardKey} onChange={handleBoardChange} />
          )}
          {/* When boards not available yet, nothing shown — toggle area is empty */}
        </div>

        {/* v1.13 (ADR-024): Sprint-goal banner — goal + % points done + days left */}
        {sprint.data && !isNoSprintError && (() => {
          const s = sprint.data.sprint;
          const t = sprint.data.totals;
          const total = t.storyPointsTotal;
          const done = t.storyPointsDone + t.storyPointsCodeReview;
          const pct = total > 0 ? Math.round((done / total) * 100) : 0;
          let daysLeft: number | null = null;
          if (s.endDate) {
            daysLeft = Math.ceil((new Date(s.endDate).getTime() - Date.now()) / 86_400_000);
          }
          return (
            <div className="mb-3 rounded-lg border border-border bg-card p-3" aria-label="Sprint goal">
              <div className="flex items-start gap-2.5">
                <Target className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <p className="text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-wide">Sprint goal</p>
                  {s.goal ? (
                    <p className="text-sm font-medium text-foreground">{s.goal}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">No goal set — add one in Planning.</p>
                  )}
                </div>
                <div className="text-right text-xs text-muted-foreground whitespace-nowrap">
                  <p><span className="font-semibold text-foreground tabular-nums">{pct}%</span> pts done</p>
                  {daysLeft !== null && s.state === "active" && (
                    <p>{daysLeft >= 0 ? `${daysLeft} day${daysLeft !== 1 ? "s" : ""} left` : "overdue"}</p>
                  )}
                </div>
              </div>
              {total > 0 && (
                <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden" role="progressbar"
                  aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Sprint goal progress">
                  <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
              )}
            </div>
          );
        })()}

        {/* v1.6: No-sprint empty state (PO Kanban or board with no sprints) */}
        {isNoSprintError ? (
          <div className="rounded-lg border border-border bg-muted/40 p-8 text-center">
            <p className="text-base font-medium text-foreground mb-1">
              No sprints on the {boardLabel} board
            </p>
            <p className="text-sm text-muted-foreground">
              Switch to the Dev board to view an active sprint, or create a new sprint on this board.
            </p>
          </div>
        ) : (
          /* v1.7 (ADR-018): New Sprint button REMOVED from Dashboard — it now lives on the Planning page */
          <SprintBoard
            data={sprint.data}
            loading={sprint.loading}
            error={sprint.error}
            onRefresh={sprint.run}
            onSelectSprint={handleSelectSprint}
            assigneeFilter={assigneeFilter}
            onAssigneeFilterChange={setAssigneeFilter}
          />
        )}
      </section>

      {/* Sidebar: Sprint command chat on top, then Huddle Digest */}
      <div className="flex flex-col gap-4 min-w-0">
        
        {/* v1.16 (ADR-027): impediments log + pending-PR list for daily visibility */}
        <section aria-label="Impediments">
          <ImpedimentsCard sprintId={effectiveSprintId} />
        </section>
        <section aria-label="Code review pull requests">
          <PullRequestsCard sprintId={effectiveSprintId} />
        </section>

        {/* Huddle Digest — NOT filtered (ADR-008) */}
        <section aria-label="Daily huddle">
          <HuddleDigest
            data={huddle.data}
            loading={huddle.loading}
            error={huddle.error}
            onRefresh={huddle.run}
          />
        </section>

        {/* Chat Panel — sprint commands on top */}
        <section aria-label="Sprint command chat">
          <ChatPanel
            selectedSprintId={selectedSprintId}
            aiStatus={aiStatus}
            assigneeFilter={assigneeFilter}
          />
        </section>

      </div>
    </div>
  );
}
