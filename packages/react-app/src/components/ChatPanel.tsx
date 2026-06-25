import { Fragment, useState, useRef, useEffect, useCallback } from "react";
import { router, type RouterAction } from "../lib/chatRouter";
import { callTool, type McpError } from "../lib/mcpClient";
import { createTicketPair, enhanceTicket } from "../hooks/useJira";
import { linkPr } from "../hooks/useGithub";
import { buildDraftPair } from "../lib/ticketTemplates";
import { aiDraftTickets, aiEnhanceTicket, aiAsk } from "../lib/aiClient";
import { ConfirmActionDialog } from "./ConfirmActionDialog";
import type { ProposedAction } from "../lib/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type {
  GetActiveSprintOutput,
  GetDailyHuddleOutput,
  GetTicketOutput,
  UpdateTicketOutput,
  ListPrsOutput,
  LinkPrOutput,
  AiStatus,
} from "../lib/types";

// ── Props ─────────────────────────────────────────────────────────────────────

interface ChatPanelProps {
  className?: string;
  /** v1.1: selected sprint ID from Dashboard, passed to sprint/huddle commands */
  selectedSprintId: number | null;
  /** v1.1: AI status from Dashboard (fetched once to avoid duplicate health calls) */
  aiStatus: AiStatus;
  /** v1.2: active assignee filter from Dashboard; applied to sprint command card */
  assigneeFilter?: string | null;
  /** v1.18: current board id, for the AI Q&A assistant context */
  boardId?: number;
  /** v1.18: effective (active) sprint id, for the AI Q&A assistant context */
  contextSprintId?: number | null;
}

// ── Message types ─────────────────────────────────────────────────────────────

type MessageRole = "user" | "assistant" | "error" | "loading";

interface ChatMessage {
  id: number;
  role: MessageRole;
  text: string;
  // Rich result payload rendered as a card
  result?: ToolResult;
}

type ToolResult =
  | { kind: "sprint"; data: GetActiveSprintOutput; assigneeFilter?: string | null }
  | { kind: "huddle"; data: GetDailyHuddleOutput }
  | { kind: "ticket"; data: GetTicketOutput }
  | { kind: "ticket-updated"; data: UpdateTicketOutput }
  | { kind: "ticket-pair"; po: { key: string; url: string }; dev: { key: string; url: string }; note?: string }
  | { kind: "pr-list"; data: ListPrsOutput }
  | { kind: "link-result"; data: LinkPrOutput };

// ── Ticket link — used in result cards ───────────────────────────────────────

// Replaces legacy .ticket-link CSS class with Tailwind utilities
function TicketLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-card border border-border rounded font-mono font-bold text-primary hover:text-primary/80 hover:shadow-sm text-[0.875rem] transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
    >
      {children}
    </a>
  );
}

// ── Result card renderers ─────────────────────────────────────────────────────

function SprintResultCard({
  data,
  assigneeFilter,
}: {
  data: GetActiveSprintOutput;
  assigneeFilter?: string | null;
}) {
  const { sprint, totals, issuesByStatus } = data;

  // v1.2: show filtered count in chat card when filter is active
  let filteredNote: string | null = null;
  if (assigneeFilter) {
    const filterFn = (assignee: string | null) =>
      assigneeFilter === "__unassigned__" ? assignee === null : assignee === assigneeFilter;
    const filteredCount =
      issuesByStatus.todo.filter((i) => filterFn(i.assignee)).length +
      issuesByStatus.inprogress.filter((i) => filterFn(i.assignee)).length +
      issuesByStatus.codereview.filter((i) => filterFn(i.assignee)).length +
      issuesByStatus.done.filter((i) => filterFn(i.assignee)).length;
    const label = assigneeFilter === "__unassigned__" ? "Unassigned" : assigneeFilter;
    filteredNote = `${filteredCount} issues for ${label}`;
  }

  return (
    <Card className="mt-2 bg-background border-border">
      <CardContent className="p-3">
        <p className="font-bold text-sm text-foreground mb-1">
          Sprint: {sprint.name}
        </p>
        <p className="text-xs text-muted-foreground">
          {totals.done}/{totals.total} issues done ·{" "}
          {totals.storyPointsDone}/{totals.storyPointsTotal} pts ·{" "}
          {totals.blocked > 0 ? `${totals.blocked} blocked` : "no blockers"}
        </p>
        {filteredNote && (
          <p className="text-sm mt-1 text-muted-foreground">{filteredNote}</p>
        )}
        {sprint.goal && <p className="mt-1 text-sm italic">{sprint.goal}</p>}
      </CardContent>
    </Card>
  );
}

function HuddleResultCard({ data }: { data: GetDailyHuddleOutput }) {
  return (
    <Card className="mt-2 bg-background border-border">
      <CardContent className="p-3">
        <p className="font-bold text-sm text-foreground mb-1">Huddle: {data.sprintName}</p>
        <p className="text-sm mt-1">{data.summaryText}</p>
      </CardContent>
    </Card>
  );
}

function TicketResultCard({ data }: { data: GetTicketOutput }) {
  return (
    <Card className="mt-2 bg-background border-border">
      <CardContent className="p-3">
        <p className="font-bold text-sm text-foreground mb-1">
          <a
            href={data.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            {data.key}
          </a>
          {" "}— {data.summary}
        </p>
        <p className="text-xs text-muted-foreground">
          {data.status} · {data.issueType} · {data.assignee ?? "Unassigned"}
          {data.storyPoints != null ? ` · ${data.storyPoints} pts` : ""}
        </p>
        {data.description && (
          <p className="text-sm mt-1 whitespace-pre-wrap break-words">
            {data.description.slice(0, 300)}{data.description.length > 300 ? "…" : ""}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function TicketUpdatedCard({ data }: { data: UpdateTicketOutput }) {
  return (
    <Card className="mt-2 bg-background border-border">
      <CardContent className="p-3">
        <p className="font-bold text-sm text-foreground mb-1">
          Updated{" "}
          <a
            href={data.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            {data.key}
          </a>
        </p>
        <p className="text-xs text-muted-foreground">Fields updated: {data.updatedFields.join(", ")}</p>
      </CardContent>
    </Card>
  );
}

function TicketPairCard({
  po,
  dev,
  note,
}: {
  po: { key: string; url: string };
  dev: { key: string; url: string };
  note?: string;
}) {
  return (
    <Card className="mt-2 bg-background border-border">
      <CardContent className="p-3">
        <p className="font-bold text-sm text-foreground mb-2">Tickets created</p>
        <div className="flex gap-3 flex-wrap">
          <TicketLink href={po.url}>PO: {po.key}</TicketLink>
          <TicketLink href={dev.url}>DEV: {dev.key}</TicketLink>
        </div>
        {note && <p className="text-xs text-muted-foreground mt-1.5">{note}</p>}
      </CardContent>
    </Card>
  );
}

function PrListCard({ data }: { data: ListPrsOutput }) {
  return (
    <Card className="mt-2 bg-background border-border">
      <CardContent className="p-3">
        <p className="font-bold text-sm text-foreground mb-1">
          {data.prs.length} open PR{data.prs.length !== 1 ? "s" : ""} — {data.repo}
        </p>
        <ul className="mt-1.5 flex flex-col gap-0.5" style={{ listStyle: "none" }}>
          {data.prs.slice(0, 10).map((pr) => (
            <li key={pr.number} className="text-sm">
              <a
                href={pr.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                #{pr.number}
              </a>
              {" "}{pr.title}
              {pr.jiraKeys.length > 0 && (
                <span className="text-muted-foreground"> [{pr.jiraKeys.join(", ")}]</span>
              )}
            </li>
          ))}
          {data.prs.length > 10 && (
            <li className="text-muted-foreground text-sm">…and {data.prs.length - 10} more</li>
          )}
        </ul>
      </CardContent>
    </Card>
  );
}

function LinkResultCard({ data }: { data: LinkPrOutput }) {
  return (
    <Card className="mt-2 bg-background border-border">
      <CardContent className="p-3">
        <p className="font-bold text-sm text-foreground mb-1">Link results</p>
        {data.results.map((r) => (
          <p key={r.ticketKey} className="text-sm mt-1">
            {r.ticketKey} — remote link: {r.remoteLinkCreated ? "✓" : "—"} · comment: {r.commentPosted ? "✓" : "—"}
            {r.error && <span className="text-muted-foreground"> ({r.error})</span>}
          </p>
        ))}
      </CardContent>
    </Card>
  );
}

function ResultCard({ result }: { result: ToolResult }) {
  switch (result.kind) {
    case "sprint":        return <SprintResultCard data={result.data} assigneeFilter={result.assigneeFilter} />;
    case "huddle":        return <HuddleResultCard data={result.data} />;
    case "ticket":        return <TicketResultCard data={result.data} />;
    case "ticket-updated":return <TicketUpdatedCard data={result.data} />;
    case "ticket-pair":   return <TicketPairCard po={result.po} dev={result.dev} note={result.note} />;
    case "pr-list":       return <PrListCard data={result.data} />;
    case "link-result":   return <LinkResultCard data={result.data} />;
  }
}

// ── Tool executor ─────────────────────────────────────────────────────────────

// perf: Each action dispatches at most 2 network calls (create pair). No streaming.
async function executeAction(
  action: RouterAction,
  aiStatus: AiStatus,
  selectedSprintId: number | null,
  assigneeFilter: string | null
): Promise<{ text: string; result?: ToolResult }> {
  if (action.kind === "help") {
    return { text: action.text };
  }

  if (action.kind === "create") {
    // v1.1 AI routing: use AI drafts when enabled (ADR-006)
    if (aiStatus.enabled) {
      try {
        const draftRes = await aiDraftTickets({
          messages: [{ role: "user", content: action.description }],
        });
        const pair = await createTicketPair({
          po: {
            summary: draftRes.po.summary,
            description: draftRes.po.description,
            storyPoints: draftRes.po.storyPoints ?? undefined,
          },
          dev: { summary: draftRes.dev.summary, description: draftRes.dev.description },
        });
        return {
          text: draftRes.assistantMessage,
          result: {
            kind: "ticket-pair",
            po: pair.po,
            dev: pair.dev,
          },
        };
      } catch (err: unknown) {
        const mcpErr = err as McpError;
        if (mcpErr.code === "AI_UNAVAILABLE") {
          // Fallback to local templates, note it
          return await createWithLocalTemplates(action.description, "(local templates — AI off)");
        }
        // Re-throw other AI errors (502/500) to be shown as error message
        throw err;
      }
    }
    // AI disabled — use local templates
    return await createWithLocalTemplates(action.description, "(local templates — AI off)");
  }

  // Generic tool dispatch
  switch (action.render) {
    case "sprint": {
      // v1.1: inject selectedSprintId for sprint command
      // v1.2: pass assigneeFilter into the result card so it can show filtered count
      const input: Record<string, number> = {};
      if (selectedSprintId !== null) input.sprintId = selectedSprintId;
      const data = await callTool<GetActiveSprintOutput>(action.server, action.tool, input);
      return { text: `Active sprint loaded.`, result: { kind: "sprint", data, assigneeFilter } };
    }
    case "huddle": {
      // v1.1: inject selectedSprintId for huddle command
      const input: Record<string, number> = {};
      if (selectedSprintId !== null) input.sprintId = selectedSprintId;
      const data = await callTool<GetDailyHuddleOutput>(action.server, action.tool, input);
      return { text: `Huddle digest for ${data.sprintName}`, result: { kind: "huddle", data } };
    }
    case "ticket": {
      const data = await callTool<GetTicketOutput>(action.server, action.tool, action.input);
      return { text: `Ticket ${data.key}: ${data.summary}`, result: { kind: "ticket", data } };
    }
    case "ticket-updated": {
      const ticketKey = (action.input as { ticketKey: string; description: string }).ticketKey;
      const notes = (action.input as { ticketKey: string; description: string }).description;

      // v1.1 AI routing for enhance (ADR-006)
      if (aiStatus.enabled) {
        try {
          const ticket = await callTool<GetTicketOutput>("jira", "get_ticket", { ticketKey });
          const enhanced = await aiEnhanceTicket({
            ticketKey,
            notes,
            current: { summary: ticket.summary, description: ticket.description },
          });
          const updated = await callTool<UpdateTicketOutput>("jira", "update_ticket", {
            ticketKey,
            summary: enhanced.summary,
            description: enhanced.description,
          });
          return {
            text: enhanced.assistantMessage,
            result: { kind: "ticket-updated", data: updated },
          };
        } catch (err: unknown) {
          const mcpErr = err as McpError;
          if (mcpErr.code === "AI_UNAVAILABLE") {
            // Fallback to v1.0 deterministic behavior
            const { ticket, updated } = await enhanceTicket(ticketKey, notes);
            return {
              text: `Updated ${ticket.key} (local templates — AI off)`,
              result: { kind: "ticket-updated", data: updated },
            };
          }
          throw err;
        }
      }
      // AI disabled — v1.0 behavior
      const { ticket, updated } = await enhanceTicket(ticketKey, notes);
      return {
        text: `Updated ${ticket.key} (local templates — AI off)`,
        result: { kind: "ticket-updated", data: updated },
      };
    }
    case "pr-list": {
      const data = await callTool<ListPrsOutput>(action.server, action.tool, action.input);
      return { text: `${data.prs.length} open PRs in ${data.repo}`, result: { kind: "pr-list", data } };
    }
    case "link-result": {
      const { number, ticketKey } = action.input as { number: number; ticketKey?: string };
      const data = await linkPr(number, ticketKey);
      return { text: `Linked PR #${number}`, result: { kind: "link-result", data } };
    }
  }
}

async function createWithLocalTemplates(
  description: string,
  note: string
): Promise<{ text: string; result: ToolResult }> {
  const drafts = buildDraftPair(description);
  const pair = await createTicketPair({
    po: { summary: drafts.po.summary, description: drafts.po.description },
    dev: { summary: drafts.dev.summary, description: drafts.dev.description },
  });
  return {
    text: `Created ticket pair for: "${description.slice(0, 80)}" ${note}`,
    result: {
      kind: "ticket-pair",
      po: pair.po,
      dev: pair.dev,
      note,
    },
  };
}

// ── Main component ────────────────────────────────────────────────────────────

let msgIdCounter = 0;
function nextId() { return ++msgIdCounter; }

export function ChatPanel({ className, selectedSprintId, aiStatus, assigneeFilter = null, boardId, contextSprintId }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: nextId(),
      role: "assistant",
      text: aiStatus.enabled
        ? "Ask anything about the sprint — \"any impediments today?\", \"who's on leave?\", \"what's in code review?\" — or type a command like huddle, sprint, or help."
        : "Sprint commands panel — type help to see available commands, or use GitHub Copilot Chat in VS Code for free-form AI questions.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // v1.19 (ADR-030): a write the assistant proposed, awaiting modal confirmation.
  const [pendingAction, setPendingAction] = useState<ProposedAction | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  // perf: autoscroll only when new messages arrive
  useEffect(() => {
    const el = logRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const appendMsg = useCallback((msg: Omit<ChatMessage, "id">) => {
    setMessages((prev) => [...prev, { ...msg, id: nextId() }]);
  }, []);

  const submit = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;

    setInput("");
    appendMsg({ role: "user", text });

    const loadingId = nextId();
    setMessages((prev) => [
      ...prev,
      { id: loadingId, role: "loading", text: "…" },
    ]);
    setBusy(true);

    try {
      const action = router(text);
      // v1.18 (ADR-029): when AI is on, input the command router doesn't recognize becomes
      // a free-form question for the AI assistant. Known commands stay deterministic (fast).
      const isUnknownCommand = action.kind === "help" && text.trim().toLowerCase() !== "help";

      let responseText: string;
      let result: ToolResult | undefined;
      if (isUnknownCommand && aiStatus.enabled) {
        const res = await aiAsk({
          question: text,
          ...(boardId !== undefined ? { boardId } : {}),
          ...(contextSprintId != null ? { sprintId: contextSprintId } : {}),
        });
        if (res.proposedAction) {
          // v1.19 (ADR-030): the assistant wants to make a change — confirm in a modal.
          responseText = res.answer || "I can do that — please review and confirm.";
          setPendingAction(res.proposedAction);
          setConfirmOpen(true);
        } else {
          responseText = res.answer;
        }
      } else {
        const out = await executeAction(action, aiStatus, selectedSprintId, assigneeFilter);
        responseText = out.text;
        result = out.result;
      }

      // Replace loading message
      setMessages((prev) =>
        prev.map((m) =>
          m.id === loadingId
            ? { id: loadingId, role: "assistant" as const, text: responseText, result }
            : m
        )
      );
    } catch (err: unknown) {
      const mcpErr = err as McpError;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === loadingId
            ? {
                id: loadingId,
                role: "error" as const,
                text: `Error [${mcpErr.code ?? "UNKNOWN"}]: ${mcpErr.message ?? String(err)}`,
              }
            : m
        )
      );
    } finally {
      setBusy(false);
    }
  }, [input, busy, appendMsg, aiStatus, selectedSprintId, assigneeFilter, boardId, contextSprintId]);

  const handleKeyDown = (e: import("react").KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <div
      className={cn(
        "flex flex-col bg-card border border-border rounded-lg shadow-sm overflow-hidden h-[480px]",
        className
      )}
    >
      {/* Header */}
      <div className="px-4 py-2.5 bg-muted/40 border-b border-border flex items-center justify-between flex-shrink-0">
        <span className="text-sm font-semibold text-foreground">
          {aiStatus.enabled ? "Sprint Assistant" : "Sprint Commands"}
        </span>
        <span className="text-xs text-muted-foreground">
          {aiStatus.enabled ? "ask or type a command" : "type "}
          {!aiStatus.enabled && (
            <code className="bg-background text-foreground border border-border px-1 py-0.5 rounded text-[0.6875rem]">
              help
            </code>
          )}
        </span>
      </div>

      {/* a11y: aria-live="polite" so screen readers announce new messages */}
      {/* perf: messages are rendered in a scrollable container — no virtualization
          needed at POC scale (sprint has ≤ 50 issues, chat sessions are short) */}
      <div
        className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2 scroll-smooth"
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-label="Chat messages"
      >
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn(
              "flex max-w-full",
              msg.role === "user" && "flex-row-reverse"
            )}
          >
            <div
              className={cn(
                "max-w-[85%] px-3 py-2 rounded-lg text-sm leading-relaxed break-words",
                msg.role === "user" && "bg-primary text-primary-foreground rounded-br-sm",
                msg.role === "assistant" && "bg-muted border border-border text-foreground rounded-bl-sm w-full max-w-full",
                msg.role === "error" && "bg-destructive/10 border border-destructive/30 text-destructive rounded-bl-sm w-full max-w-full",
                msg.role === "loading" && "text-muted-foreground italic"
              )}
            >
              {msg.text.split("\n").map((line, i) => (
                <Fragment key={i}>
                  {line}
                  {i < msg.text.split("\n").length - 1 && <br />}
                </Fragment>
              ))}
              {msg.result && <ResultCard result={msg.result} />}
            </div>
          </div>
        ))}
      </div>

      {/* a11y: input form with label */}
      <form
        className="px-3 py-2.5 bg-muted/40 border-t border-border flex gap-2 flex-shrink-0"
        onSubmit={(e) => { e.preventDefault(); void submit(); }}
        aria-label="Sprint command input"
      >
        {/* a11y: sr-only label for the textarea */}
        <label htmlFor="chat-input" className="sr-only">Type a sprint command</label>
        <Textarea
          id="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={aiStatus.enabled ? "Ask anything, or type a command…" : "sprint · huddle · ticket DEV-42 · help"}
          rows={1}
          disabled={busy}
          aria-label="Sprint command"
          className="flex-1 min-h-[36px] max-h-[120px] resize-none text-sm"
        />
        <Button
          type="submit"
          size="sm"
          disabled={busy || !input.trim()}
          aria-label="Send command"
          className="flex-shrink-0 self-end"
        >
          Send
        </Button>
      </form>

      {/* v1.19 (ADR-030): modal confirmation for an assistant-proposed write */}
      <ConfirmActionDialog
        action={pendingAction}
        open={confirmOpen}
        onOpenChange={(o) => { setConfirmOpen(o); if (!o) setPendingAction(null); }}
        onResult={(msg) => appendMsg({ role: "assistant", text: msg })}
      />
    </div>
  );
}
