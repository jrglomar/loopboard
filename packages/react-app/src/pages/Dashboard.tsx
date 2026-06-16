import { useState, useEffect } from "react";
import { SprintBoard } from "../components/SprintBoard";
import { HuddleDigest } from "../components/HuddleDigest";
import { ChatPanel } from "../components/ChatPanel";
import { BoardToggle } from "../components/BoardToggle";
import { useActiveSprint, useDailyHuddle } from "../hooks/useJira";
import { getAiStatus } from "../lib/aiClient";
import { useBoards } from "../lib/boards";
import type { AiStatus, BoardKey } from "../lib/types";

// a11y: main landmark is provided by the App shell; Dashboard uses the slot.
export function Dashboard() {
  // v1.6: Board context — load once from health (ADR-017)
  const { boards, loading: boardsLoading } = useBoards();

  // v1.6: Selected board key (default = "dev"). Null boardId until boards loads.
  const [selectedBoardKey, setSelectedBoardKey] = useState<BoardKey>("dev");

  // The numeric board id passed to hooks. Null = not yet loaded → tools use server default (dev)
  const selectedBoardId: number | undefined =
    boards ? boards[selectedBoardKey].id : undefined;

  // v1.1: Dashboard owns selectedSprintId (ADR-007)
  const [selectedSprintId, setSelectedSprintId] = useState<number | null>(null);
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
        setSelectedSprintId(null);
      }
    }
  }, [sprint.data, selectedSprintId]);

  const handleSelectSprint = (id: number) => {
    // v1.2: reset assignee filter when sprint changes (ADR-008)
    setAssigneeFilter(null);
    setSelectedSprintId(id);
  };

  // v1.6: Board switch — reset sprint + filter, then refetch
  const handleBoardChange = (key: BoardKey) => {
    setSelectedBoardKey(key);
    setSelectedSprintId(null);
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
