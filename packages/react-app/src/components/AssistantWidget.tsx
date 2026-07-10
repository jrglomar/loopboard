// AssistantWidget — global floating chatbot (v1.19, ADR-030).
// A fixed FAB at the lower-right that pops the AI Sprint Assistant (ChatPanel) on click.
// Rendered once in App.tsx so it's available on every tab.

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
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
  const boardId = boards?.dev[0]?.id; // v1.25 (ADR-037): default Dev project for AI context
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

/** Focusable elements inside `root`, in DOM order, skipping hidden ones. */
function focusablesIn(root: HTMLElement): HTMLElement[] {
  const sel = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
  return Array.from(root.querySelectorAll<HTMLElement>(sel)).filter((el) => el.offsetParent !== null);
}

export function AssistantWidget() {
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const toggle = () => {
    setEverOpened(true);
    setOpen((v) => !v);
  };

  // v1.48 (UI review A11Y-01): make the aria-modal dialog behave like one — move focus into the
  // panel on open, restore it to the trigger on close.
  useEffect(() => {
    if (open) {
      const panel = panelRef.current;
      if (panel) (focusablesIn(panel)[0] ?? panel).focus();
    } else if (everOpened) {
      triggerRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Escape closes; Tab is trapped inside the panel while it's open.
  function onPanelKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.stopPropagation();
      setOpen(false);
      return;
    }
    if (e.key !== "Tab" || !panelRef.current) return;
    const items = focusablesIn(panelRef.current);
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

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
          ref={panelRef}
          tabIndex={-1}
          onKeyDown={onPanelKeyDown}
          className={cn(
            "fixed bottom-[5.5rem] right-4 sm:right-5 z-50 w-[750px] max-w-[calc(100vw-2rem)]",
            "rounded-lg shadow-2xl ring-1 ring-black/5 focus:outline-none",
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
        ref={triggerRef}
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
