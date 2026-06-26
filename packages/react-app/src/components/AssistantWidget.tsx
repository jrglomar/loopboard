// AssistantWidget — global floating chatbot (v1.19, ADR-030).
// A fixed FAB at the lower-right that pops the AI Sprint Assistant (ChatPanel) on click.
// Rendered once in App.tsx so it's available on every tab.

import { useState } from "react";
import { useEffect } from "react";
import { MessageCircle, X } from "lucide-react";
import { ChatPanel } from "./ChatPanel";
import { getAiStatus } from "../lib/aiClient";
import { useBoards } from "../lib/boards";
import { useActiveSprint } from "../hooks/useJira";
import type { AiStatus } from "../lib/types";
import { cn } from "@/lib/utils";

/**
 * The actual assistant panel — split out so its context fetches (AI status, boards,
 * active sprint) happen ONLY after the user first opens the widget (lazy), and then
 * stay mounted so the conversation + context persist across open/close.
 */
function AssistantPanel() {
  const [aiStatus, setAiStatus] = useState<AiStatus>({ enabled: false, provider: null, model: null });

  useEffect(() => {
    getAiStatus()
      .then(setAiStatus)
      .catch(() => setAiStatus({ enabled: false, provider: null, model: null }));
  }, []);

  const { boards } = useBoards();
  const boardId = boards?.dev.id;
  // Effective sprint = the dev board's active sprint, used as AI context (board/sprint ids).
  const sprint = useActiveSprint(boardId, null);
  const effectiveSprintId = sprint.data?.sprint.id ?? null;

  return (
    <ChatPanel
      selectedSprintId={effectiveSprintId}
      aiStatus={aiStatus}
      boardId={boardId}
      contextSprintId={effectiveSprintId}
    />
  );
}

export function AssistantWidget() {
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);

  const toggle = () => {
    setEverOpened(true);
    setOpen((v) => !v);
  };

  return (
    <>
      {/* Dim scrim behind the panel while open — click to dismiss */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px] transition-opacity"
          aria-hidden="true"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Popup panel — mounted after first open, hidden (not unmounted) when closed */}
      {everOpened && (
        <div
          className={cn(
            "fixed bottom-[5.5rem] right-4 sm:right-5 z-50 w-[750px] max-w-[calc(100vw-2rem)]",
            "rounded-lg shadow-2xl ring-1 ring-black/5",
            !open && "hidden"
          )}
          role="dialog"
          aria-modal="true"
          aria-label="Sprint assistant"
        >
          <AssistantPanel />
        </div>
      )}

      {/* Floating action button */}
      <button
        type="button"
        onClick={toggle}
        aria-label={open ? "Close sprint assistant" : "Open sprint assistant"}
        aria-expanded={open}
        className={cn(
          "fixed bottom-4 right-4 sm:bottom-5 sm:right-5 z-50 h-14 w-14 rounded-full",
          "bg-primary text-primary-foreground shadow-lg flex items-center justify-center",
          "hover:bg-primary/90 transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        )}
      >
        {open ? <X className="h-6 w-6" aria-hidden="true" /> : <MessageCircle className="h-6 w-6" aria-hidden="true" />}
      </button>
    </>
  );
}
