import { useState, useEffect, useId, useRef, Fragment } from "react";
import { buildDraftPair } from "../lib/ticketTemplates";
import { createTicketPair, useSprintList } from "../hooks/useJira";
import { getAiStatus, aiDraftTickets } from "../lib/aiClient";
import { RefineDraftControl } from "../components/RefineDraftControl";
import { useBoards } from "../lib/boards";
import { type McpError } from "../lib/mcpClient";
import { type TicketRef, type AiStatus, type AiMessage } from "../lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface FormState {
  featureDescription: string;
  storyPoints: string;
  technicalNotes: string;
}

interface DraftState {
  poSummary: string;
  poDescription: string;
  devSummary: string;
  devDescription: string;
}

interface SuccessState {
  po: TicketRef;
  dev: TicketRef;
  /** v1.4: sprint name if a sprint was targeted (single sprint — v1.4 fallback) */
  targetSprintName?: string;
  /** v1.6: separate PO sprint name (two-sprint flow) */
  poSprintName?: string;
  /** v1.6: separate Dev sprint name (two-sprint flow) */
  devSprintName?: string;
  /** v1.4: non-fatal warning if PO ticket could not be added to the sprint */
  poSprintWarning?: string;
  /** v1.4: non-fatal warning if Dev ticket could not be added to the sprint */
  devSprintWarning?: string;
  /** v1.4: legacy single sprint warning (kept for backwards compat) */
  sprintWarning?: string;
}

type PagePhase = "form" | "preview" | "creating" | "success";

// ── AI Chat types ─────────────────────────────────────────────────────────────

interface BubbleMessage {
  id: number;
  role: "user" | "assistant" | "error";
  text: string;
}

let bubbleIdCounter = 0;
function nextBubbleId() { return ++bubbleIdCounter; }

// ── Ticket link — replaces legacy .ticket-link CSS class ─────────────────────

function TicketLink({ href, children, ariaLabel }: { href: string; children: React.ReactNode; ariaLabel?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 px-4 py-2 bg-card border border-success-border rounded font-mono font-bold text-primary hover:text-primary/80 hover:shadow-md text-[0.9375rem] transition-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
      aria-label={ariaLabel}
    >
      {children}
    </a>
  );
}

// ── AI Chat thread component ──────────────────────────────────────────────────

function ChatThread({ messages }: { messages: BubbleMessage[] }) {
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  if (messages.length === 0) return null;

  return (
    // a11y: aria-live="polite" so screen readers announce new AI replies
    <div
      className="max-h-[320px] overflow-y-auto flex flex-col gap-2 mb-3 p-3 bg-muted/40 border border-border rounded-lg scroll-smooth"
      ref={threadRef}
      role="log"
      aria-live="polite"
      aria-label="AI conversation"
    >
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={cn(
            "flex max-w-full",
            msg.role === "user" && "justify-end",
            msg.role !== "user" && "justify-start"
          )}
        >
          <div
            className={cn(
              "max-w-[85%] px-3.5 py-2 rounded-lg text-[0.9375rem] leading-relaxed break-words",
              msg.role === "user" && "bg-primary text-primary-foreground rounded-br-sm",
              msg.role === "assistant" && "bg-card border border-border text-foreground rounded-bl-sm",
              msg.role === "error" && "bg-destructive/10 border border-destructive/30 text-destructive rounded-bl-sm w-full max-w-full"
            )}
          >
            {msg.text.split("\n").map((line, i, arr) => (
              <Fragment key={i}>
                {line}
                {i < arr.length - 1 && <br />}
              </Fragment>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── AI provider badge ─────────────────────────────────────────────────────────

function AiBadge({ provider, model }: { provider: string | null; model: string | null }) {
  if (!provider) return null;
  return (
    <Badge
      variant="outline"
      className="text-[0.6875rem] font-bold border-primary text-primary bg-primary/10 whitespace-nowrap flex-shrink-0"
      aria-label={`AI: ${provider} · ${model ?? "unknown"}`}
    >
      AI: {provider} · {model ?? "unknown"}
    </Badge>
  );
}

// ── Fallback banner (v1.2: two variants) ─────────────────────────────────────

/**
 * v1.2 contract: distinguish "AI genuinely disabled" from "switched to local".
 * - aiGenuinelyDisabled: AI_PROVIDER is unset; show instructions banner only, no toggle.
 * - forceFallback (AI available but user/error switched): show "Use AI drafting" button.
 */
interface FallbackBannerProps {
  onDismiss: () => void;
  /** Whether AI is genuinely disabled (no toggle shown) vs user switched to local */
  aiGenuinelyDisabled: boolean;
  /** Called when user clicks "Use AI drafting" — only shown when !aiGenuinelyDisabled */
  onUseAi?: () => void;
}

function FallbackBanner({ onDismiss, aiGenuinelyDisabled, onUseAi }: FallbackBannerProps) {
  // v1.3: use semantic token Tailwind classes (bg-warning-bg / border-warning-border)
  const bannerClass = "mb-4 border bg-warning-bg border-warning-border text-warning-foreground";

  if (aiGenuinelyDisabled) {
    // AI is genuinely off — instructions only, no toggle button
    return (
      <Alert className={bannerClass} role="status" aria-live="polite">
        <AlertDescription className="flex items-start justify-between gap-2">
          <span className="flex-1 leading-relaxed text-sm">
            AI drafting is off — using local templates.
            Set <code className="bg-warning-bg border border-warning-border px-1 rounded text-xs">AI_PROVIDER</code> in{" "}
            <code className="bg-warning-bg border border-warning-border px-1 rounded text-xs">.env</code> to enable (
            <code className="bg-warning-bg border border-warning-border px-1 rounded text-xs">docs/SETUP.md</code>).
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onDismiss}
            aria-label="Dismiss AI fallback notice"
            className="flex-shrink-0 text-warning-foreground hover:bg-warning-border/40 h-auto p-0 text-base leading-none"
          >
            ✕
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  // AI was available but user/error switched to local — show "Use AI drafting" button
  return (
    <Alert className={bannerClass} role="status" aria-live="polite">
      <AlertDescription className="flex items-start justify-between gap-2 flex-wrap">
        <span className="flex-1 leading-relaxed text-sm">
          Using local templates. AI drafting is available.
        </span>
        <div className="flex items-center gap-2 flex-shrink-0">
          {onUseAi && (
            // a11y: button text "Use AI drafting" is descriptive; no override needed
            <Button
              type="button"
              size="sm"
              onClick={onUseAi}
            >
              Use AI drafting
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onDismiss}
            aria-label="Dismiss AI fallback notice"
            className="text-warning-foreground hover:bg-warning-border/40 h-auto p-0 text-base leading-none"
          >
            ✕
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

// ── Target Sprint Select (v1.4, ADR-011) ─────────────────────────────────────

interface TargetSprintSelectProps {
  /** Active + future sprints from list_sprints */
  sprintListData: import("../lib/types").ListSprintsResponse | null;
  sprintListLoading: boolean;
  value: number | undefined;
  onChange: (sprintId: number | undefined) => void;
  formId: string;
  /** Optional label override — defaults to "Add to sprint" */
  label?: string;
  /** Aria label override */
  ariaLabel?: string;
}

function TargetSprintSelect({ sprintListData, sprintListLoading, value, onChange, formId, label, ariaLabel }: TargetSprintSelectProps) {
  const selectId = `${formId}-target-sprint`;
  const displayLabel = label ?? "Add to sprint";
  const hasOptions = sprintListData
    ? (sprintListData.active.length + sprintListData.future.length) > 0
    : false;

  return (
    <div className="space-y-1">
      <Label htmlFor={selectId} className="text-xs font-semibold">
        {displayLabel} <span className="text-muted-foreground font-normal">(optional)</span>
      </Label>
      {/* a11y: native <select> — consistent with ADR-009 */}
      <select
        id={selectId}
        className="h-9 w-full text-xs px-2 border border-border rounded-md bg-background text-foreground font-[inherit] cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 transition-colors hover:border-ring disabled:opacity-50 disabled:cursor-not-allowed"
        value={value ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === "" ? undefined : parseInt(v, 10));
        }}
        disabled={sprintListLoading || !hasOptions}
        aria-label={ariaLabel ?? displayLabel}
      >
        <option value="">Backlog / no sprint</option>
        {sprintListData && sprintListData.active.length > 0 && (
          <optgroup label="Active">
            {sprintListData.active.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </optgroup>
        )}
        {sprintListData && sprintListData.future.length > 0 && (
          <optgroup label="Future">
            {sprintListData.future.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </optgroup>
        )}
      </select>
      {!sprintListLoading && !hasOptions && (
        <p className="text-xs text-muted-foreground">No active or future sprints found.</p>
      )}
    </div>
  );
}

// ── Draft preview panes (shared between AI and fallback modes) ────────────────

interface DraftPreviewProps {
  draft: DraftState;
  onChangeDraft: (d: DraftState) => void;
  formId: string;
}

function DraftPreview({ draft, onChangeDraft, formId }: DraftPreviewProps) {
  return (
    // Migrate from .draft-preview CSS class to Tailwind grid
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      {/* PO Story pane */}
      <Card>
        <CardHeader className="pb-3">
          {/* a11y: Badge is decorative; card role conveys context */}
          <Badge className="w-fit text-[0.6875rem] font-extrabold uppercase tracking-wide bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-100">
            PO Story
          </Badge>
        </CardHeader>
        <CardContent className="pt-0 space-y-4">
          <div>
            <Label htmlFor={`${formId}-po-sum`} className="text-sm font-semibold mb-1.5 block">Summary</Label>
            <Input
              id={`${formId}-po-sum`}
              type="text"
              value={draft.poSummary}
              onChange={(e) => onChangeDraft({ ...draft, poSummary: e.target.value })}
              maxLength={255}
            />
          </div>
          <div>
            <Label htmlFor={`${formId}-po-desc`} className="text-sm font-semibold mb-1.5 block">Description</Label>
            <Textarea
              id={`${formId}-po-desc`}
              value={draft.poDescription}
              onChange={(e) => onChangeDraft({ ...draft, poDescription: e.target.value })}
              rows={12}
              className="font-mono text-[0.8125rem]"
            />
          </div>
        </CardContent>
      </Card>

      {/* Dev Task pane */}
      <Card>
        <CardHeader className="pb-3">
          <Badge className="w-fit text-[0.6875rem] font-extrabold uppercase tracking-wide bg-green-100 text-green-700 border-green-200 hover:bg-green-100">
            Dev Task
          </Badge>
        </CardHeader>
        <CardContent className="pt-0 space-y-4">
          <div>
            <Label htmlFor={`${formId}-dev-sum`} className="text-sm font-semibold mb-1.5 block">Summary</Label>
            <Input
              id={`${formId}-dev-sum`}
              type="text"
              value={draft.devSummary}
              onChange={(e) => onChangeDraft({ ...draft, devSummary: e.target.value })}
              maxLength={255}
            />
          </div>
          <div>
            <Label htmlFor={`${formId}-dev-desc`} className="text-sm font-semibold mb-1.5 block">Description</Label>
            <Textarea
              id={`${formId}-dev-desc`}
              value={draft.devDescription}
              onChange={(e) => onChangeDraft({ ...draft, devDescription: e.target.value })}
              rows={12}
              className="font-mono text-[0.8125rem]"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── TicketGen props ───────────────────────────────────────────────────────────

/**
 * Optional pre-seed props (v1.7, ADR-018) — when TicketGen is embedded inside
 * the Planning page, the planned sprint for each board can be pre-selected.
 * Both are optional so the component works standalone (default = "Backlog").
 */
export interface TicketGenProps {
  /** Pre-select this sprint in the PO sprint selector (Planning context, ADR-018). */
  initialPoSprintId?: number;
  /** Pre-select this sprint in the Dev sprint selector (Planning context, ADR-018). */
  initialDevSprintId?: number;
}

// ── Main component ────────────────────────────────────────────────────────────

export function TicketGen({ initialPoSprintId, initialDevSprintId }: TicketGenProps = {}) {
  const formId = useId();

  // AI status — fetched on mount
  const [aiStatus, setAiStatus] = useState<AiStatus>({ enabled: false, provider: null, model: null });
  const [aiStatusLoading, setAiStatusLoading] = useState(true);

  /**
   * v1.2: track WHY we're in fallback:
   * - aiStatus.enabled === false after health check → AI genuinely disabled
   * - forceFallback === true while aiStatus.enabled is/was true → user/error switched to local
   *
   * "Use AI drafting" button is shown ONLY when forceFallback && !aiGenuinelyDisabled
   */
  const [forceFallback, setForceFallback] = useState(false);
  const [fallbackBannerVisible, setFallbackBannerVisible] = useState(true);

  // AI chat state
  const [bubbles, setBubbles] = useState<BubbleMessage[]>([]);
  const [conversationHistory, setConversationHistory] = useState<AiMessage[]>([]);
  const [aiInput, setAiInput] = useState("");
  const [aiSending, setAiSending] = useState(false);
  const [storyPoints, setStoryPoints] = useState("");

  // Shared draft + creation state
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [phase, setPhase] = useState<PagePhase>("form");
  const [createError, setCreateError] = useState<McpError | null>(null);
  const [success, setSuccess] = useState<SuccessState | null>(null);

  // v1.0 fallback form state
  const [form, setForm] = useState<FormState>({
    featureDescription: "",
    storyPoints: "",
    technicalNotes: "",
  });
  const [validationError, setValidationError] = useState<string | null>(null);

  // v1.6 (ADR-017): board context for two-sprint selects
  const { boards } = useBoards();

  // v1.6: separate PO and Dev sprint selects (active+future only)
  // perf: each board gets its own sprint list hook (called with per-board id)
  const poSprintList = useSprintList("all", boards?.po.id);
  const devSprintList = useSprintList("all", boards?.dev.id);

  // v1.4 (legacy): single sprint select used when boards is null (older bridge fallback)
  const sprintList = useSprintList("all");

  // v1.6: PO and Dev sprint selects
  // v1.7 (ADR-018): initialised from Planning pre-seed props when provided
  const [poTargetSprintId, setPoTargetSprintId] = useState<number | undefined>(initialPoSprintId);
  const [devTargetSprintId, setDevTargetSprintId] = useState<number | undefined>(initialDevSprintId);
  // v1.4 legacy: single sprint select (used when boards is null)
  const [targetSprintId, setTargetSprintId] = useState<number | undefined>(undefined);

  const aiInputRef = useRef<HTMLTextAreaElement>(null);

  // AI genuinely disabled = health said so AND user hasn't force-switched from AI
  const aiGenuinelyDisabled = !aiStatus.enabled && !forceFallback;

  // Effective AI mode: status says enabled AND user has not forced fallback
  const useAiMode = aiStatus.enabled && !forceFallback;

  useEffect(() => {
    setAiStatusLoading(true);
    getAiStatus()
      .then((status) => {
        setAiStatus(status);
        setAiStatusLoading(false);
      })
      .catch(() => {
        setAiStatus({ enabled: false, provider: null, model: null });
        setAiStatusLoading(false);
      });
  }, []);

  // ── AI mode handlers ───────────────────────────────────────────────────────

  const handleAiSend = async (textArg?: string) => {
    // v1.12 (ADR-023): textArg lets the draft's "Regenerate" control re-draft from
    // a comment without touching the main chat input.
    const text = (textArg ?? aiInput).trim();
    if (!text || aiSending) return;

    if (textArg === undefined) setAiInput("");
    const userBubble: BubbleMessage = { id: nextBubbleId(), role: "user", text };
    setBubbles((prev) => [...prev, userBubble]);

    const newHistory: AiMessage[] = [
      ...conversationHistory,
      { role: "user", content: text },
    ];
    setConversationHistory(newHistory);

    setAiSending(true);
    try {
      const sp = storyPoints ? parseInt(storyPoints, 10) : undefined;
      const res = await aiDraftTickets({
        messages: newHistory,
        storyPoints: sp,
      });

      // Append assistant bubble
      const assistantBubble: BubbleMessage = {
        id: nextBubbleId(),
        role: "assistant",
        text: res.assistantMessage,
      };
      setBubbles((prev) => [...prev, assistantBubble]);

      // Update conversation history with assistant reply
      setConversationHistory([...newHistory, { role: "assistant", content: res.assistantMessage }]);

      // Replace draft cards with AI result
      setDraft({
        poSummary: res.po.summary,
        poDescription: res.po.description,
        devSummary: res.dev.summary,
        devDescription: res.dev.description,
      });
      if (phase === "form") setPhase("preview");
    } catch (err: unknown) {
      const mcpErr = err as McpError;
      if (mcpErr.code === "AI_UNAVAILABLE") {
        // Switch to fallback mode with banner
        setForceFallback(true);
        setFallbackBannerVisible(true);
        // Pre-fill the fallback form with the last user message
        setForm((f) => ({ ...f, featureDescription: text }));
      } else {
        // In-thread error bubble with fallback action
        const errBubble: BubbleMessage = {
          id: nextBubbleId(),
          role: "error",
          text: `AI error [${mcpErr.code ?? "UNKNOWN"}]: ${mcpErr.message}`,
        };
        setBubbles((prev) => [...prev, errBubble]);
      }
    } finally {
      setAiSending(false);
    }
  };

  const handleAiKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleAiSend();
    }
  };

  const handleSwitchToFallback = (lastUserText: string) => {
    setForceFallback(true);
    setFallbackBannerVisible(true);
    setForm((f) => ({ ...f, featureDescription: lastUserText }));
  };

  /**
   * v1.2: "Use AI drafting" — clears forceFallback, re-checks AI status.
   * If AI is enabled → return to AI chat (seed with current description if any).
   * If still disabled → show the disabled-instructions banner (no console error).
   */
  const handleUseAiDrafting = async () => {
    // Save current description before clearing state
    const seedText = form.featureDescription.trim();

    setForceFallback(false);
    setFallbackBannerVisible(true);
    setAiStatusLoading(true);

    try {
      const freshStatus = await getAiStatus();
      setAiStatus(freshStatus);
      setAiStatusLoading(false);

      if (freshStatus.enabled) {
        // Seed the AI input with the current feature description if any
        if (seedText) {
          setAiInput(seedText);
          // Focus the AI textarea after the mode switch
          setTimeout(() => aiInputRef.current?.focus(), 50);
        }
      } else {
        // AI is still off — genuinely disabled; banner will show instructions (no toggle)
        // forceFallback stays false so aiGenuinelyDisabled = true → instructions-only banner
      }
    } catch {
      // If health check fails, treat as disabled — no console error
      setAiStatus({ enabled: false, provider: null, model: null });
      setAiStatusLoading(false);
    }
  };

  // ── v1.0 fallback handlers ─────────────────────────────────────────────────

  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    const desc = form.featureDescription.trim();
    if (!desc) {
      setValidationError("Feature description is required.");
      return;
    }
    setValidationError(null);
    const sp = form.storyPoints ? parseInt(form.storyPoints, 10) : undefined;
    const pair = buildDraftPair(desc, sp, form.technicalNotes || undefined);
    setDraft({
      poSummary: pair.po.summary,
      poDescription: pair.po.description,
      devSummary: pair.dev.summary,
      devDescription: pair.dev.description,
    });
    setPhase("preview");
  };

  const handleCreate = async () => {
    if (!draft) return;
    setPhase("creating");
    setCreateError(null);
    try {
      const sp = useAiMode
        ? (storyPoints ? parseInt(storyPoints, 10) : undefined)
        : (form.storyPoints ? parseInt(form.storyPoints, 10) : undefined);

      // v1.6 (ADR-017): two-sprint flow when boards is available
      if (boards !== null) {
        // Look up PO and Dev sprint names for the success panel
        const allPoSprints = poSprintList.data
          ? [...poSprintList.data.active, ...poSprintList.data.future, ...poSprintList.data.closed]
          : [];
        const allDevSprints = devSprintList.data
          ? [...devSprintList.data.active, ...devSprintList.data.future, ...devSprintList.data.closed]
          : [];

        const poSprint = poTargetSprintId !== undefined
          ? allPoSprints.find((s) => s.id === poTargetSprintId)
          : undefined;
        const devSprint = devTargetSprintId !== undefined
          ? allDevSprints.find((s) => s.id === devTargetSprintId)
          : undefined;

        const result = await createTicketPair({
          po: {
            summary: draft.poSummary,
            description: draft.poDescription,
            storyPoints: sp,
            sprintId: poTargetSprintId,
          },
          dev: {
            summary: draft.devSummary,
            description: draft.devDescription,
            sprintId: devTargetSprintId,
          },
        });

        setSuccess({
          po: result.po,
          dev: result.dev,
          poSprintName: poSprint?.name,
          devSprintName: devSprint?.name,
          poSprintWarning: result.po.sprintWarning,
          devSprintWarning: result.dev.sprintWarning,
        });
        setPhase("success");
        return;
      }

      // v1.4 legacy: single sprint select (boards not available — older bridge)
      const allSprints = sprintList.data
        ? [...sprintList.data.active, ...sprintList.data.future, ...sprintList.data.closed]
        : [];
      const targetSprint = targetSprintId !== undefined
        ? allSprints.find((s) => s.id === targetSprintId)
        : undefined;

      const result = await createTicketPair({
        po: {
          summary: draft.poSummary,
          description: draft.poDescription,
          storyPoints: sp,
          sprintId: targetSprintId,
        },
        dev: {
          summary: draft.devSummary,
          description: draft.devDescription,
          sprintId: targetSprintId,
        },
      });

      // Collect any sprint warning from dev (most likely board; po is secondary)
      const sprintWarning = result.dev.sprintWarning ?? result.po.sprintWarning;

      setSuccess({
        po: result.po,
        dev: result.dev,
        targetSprintName: targetSprint?.name,
        sprintWarning,
      });
      setPhase("success");
    } catch (err: unknown) {
      const mcpErr = err as McpError;
      setCreateError(mcpErr);
      setPhase("preview");
    }
  };

  const handleReset = () => {
    setForm({ featureDescription: "", storyPoints: "", technicalNotes: "" });
    setDraft(null);
    setPhase("form");
    setValidationError(null);
    setCreateError(null);
    setSuccess(null);
    setBubbles([]);
    setConversationHistory([]);
    setAiInput("");
    setStoryPoints("");
    setForceFallback(false);
    setFallbackBannerVisible(true);
    setTargetSprintId(undefined);
    setPoTargetSprintId(undefined);
    setDevTargetSprintId(undefined);
  };

  // ── Render: Success ───────────────────────────────────────────────────────

  if (phase === "success" && success) {
    return (
      // Migrated from .ticket-gen CSS class → max-w-5xl
      <div className="max-w-5xl">
        <h2 className="text-2xl font-bold mb-5">Ticket Generator</h2>
        {/* Use --success-* CSS tokens instead of raw Tailwind green values */}
        <Card
          className="bg-success-bg border-success-border"
          role="status"
          aria-live="polite"
        >
          <CardContent className="p-8 text-center">
            <div className="text-5xl mb-3" aria-hidden="true">✓</div>
            <h3 className="text-lg font-bold text-success mb-4">
              Tickets created in Jira!
            </h3>
            <div className="flex justify-center gap-4 flex-wrap mb-4">
              <TicketLink
                href={success.po.url}
                ariaLabel={`Open PO ticket ${success.po.key} in Jira`}
              >
                PO: {success.po.key}
              </TicketLink>
              <TicketLink
                href={success.dev.url}
                ariaLabel={`Open Dev ticket ${success.dev.key} in Jira`}
              >
                DEV: {success.dev.key}
              </TicketLink>
            </div>
            {/* v1.6: two-sprint success notes (PO + Dev) */}
            {(success.poSprintName || success.devSprintName) && (
              <div className="text-sm text-muted-foreground mb-2 space-y-0.5">
                {success.poSprintName && (
                  <p>
                    PO story → sprint:{" "}
                    <span className="font-semibold text-foreground">{success.poSprintName}</span>
                  </p>
                )}
                {success.devSprintName && (
                  <p>
                    Dev task → sprint:{" "}
                    <span className="font-semibold text-foreground">{success.devSprintName}</span>
                  </p>
                )}
              </div>
            )}
            {/* v1.4: legacy single target sprint note (older bridge fallback) */}
            {success.targetSprintName && !success.poSprintName && !success.devSprintName && (
              <p className="text-sm text-muted-foreground mb-2">
                Added to sprint: <span className="font-semibold text-foreground">{success.targetSprintName}</span>
              </p>
            )}
            {/* v1.6: per-ticket sprint warnings — non-fatal */}
            {(success.poSprintWarning || success.devSprintWarning) && (
              <Alert
                className="mb-4 text-left bg-warning-bg border-warning-border text-warning-foreground text-xs"
                role="status"
                aria-label="Sprint assignment note"
              >
                <AlertDescription className="space-y-1">
                  {success.poSprintWarning && <p>⚠ PO sprint: {success.poSprintWarning}</p>}
                  {success.devSprintWarning && <p>⚠ Dev sprint: {success.devSprintWarning}</p>}
                </AlertDescription>
              </Alert>
            )}
            {/* v1.4: legacy single sprint warning (older bridge fallback) */}
            {success.sprintWarning && !success.poSprintWarning && !success.devSprintWarning && (
              <Alert
                className="mb-4 text-left bg-warning-bg border-warning-border text-warning-foreground text-xs"
                role="status"
                aria-label="Sprint assignment note"
              >
                <AlertDescription>
                  ⚠ Sprint note: {success.sprintWarning}
                </AlertDescription>
              </Alert>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={handleReset}
            >
              Create another
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Render: Loading AI status ─────────────────────────────────────────────

  if (aiStatusLoading) {
    return (
      <div className="max-w-5xl">
        <h2 className="text-2xl font-bold mb-5">Ticket Generator</h2>
        <div aria-busy="true" aria-label="Loading AI status">
          <Skeleton className="h-5 w-2/5" />
        </div>
      </div>
    );
  }

  // ── Render: AI mode ───────────────────────────────────────────────────────

  if (useAiMode) {
    return (
      <div className="max-w-5xl">
        <div className="flex items-center gap-3 flex-wrap mb-5">
          <h2 className="text-2xl font-bold">Ticket Generator</h2>
          <AiBadge provider={aiStatus.provider} model={aiStatus.model} />
        </div>

        {/* AI Chat thread */}
        <ChatThread messages={bubbles} />

        {/* AI input area */}
        <Card className="mb-4 shadow-sm">
          <CardContent className="p-3 space-y-2">
            <div>
              {/* a11y: label for the AI input */}
              <Label htmlFor={`${formId}-ai-input`} className="sr-only">
                Describe the feature, follow up to refine
              </Label>
              <Textarea
                id={`${formId}-ai-input`}
                ref={aiInputRef}
                value={aiInput}
                onChange={(e) => setAiInput(e.target.value)}
                onKeyDown={handleAiKeyDown}
                placeholder="Describe the feature… follow up to refine"
                rows={2}
                disabled={aiSending}
                aria-label="Describe the feature or follow up to refine"
                className="min-h-[56px] max-h-[160px] resize-y"
              />
            </div>
            <div className="flex items-end gap-2 flex-wrap">
              <div className="space-y-1">
                {/* a11y: story points label — standardized to "Story points" */}
                <Label htmlFor={`${formId}-ai-pts`} className="text-xs font-semibold">
                  Story points
                </Label>
                <Input
                  id={`${formId}-ai-pts`}
                  type="number"
                  min={0}
                  className="w-24"
                  value={storyPoints}
                  onChange={(e) => setStoryPoints(e.target.value)}
                  placeholder="opt."
                />
              </div>
              {/* v1.6 (ADR-017): two sprint selects when boards available; fallback to single */}
              {boards !== null ? (
                <div className="flex flex-col sm:flex-row gap-2 flex-1 min-w-[280px]">
                  {/* PO sprint — for the PO story */}
                  <div className="flex-1 min-w-[120px]">
                    <TargetSprintSelect
                      sprintListData={poSprintList.data}
                      sprintListLoading={poSprintList.loading}
                      value={poTargetSprintId}
                      onChange={setPoTargetSprintId}
                      formId={`${formId}-po`}
                      label="PO sprint"
                      ariaLabel="PO story sprint"
                    />
                  </div>
                  {/* Dev sprint — for the Dev task */}
                  <div className="flex-1 min-w-[120px]">
                    <TargetSprintSelect
                      sprintListData={devSprintList.data}
                      sprintListLoading={devSprintList.loading}
                      value={devTargetSprintId}
                      onChange={setDevTargetSprintId}
                      formId={`${formId}-dev`}
                      label="Dev sprint"
                      ariaLabel="Dev task sprint"
                    />
                  </div>
                </div>
              ) : (
                /* v1.4 fallback: single Dev sprint select (older bridge) */
                <div className="flex-1 min-w-[180px]">
                  <TargetSprintSelect
                    sprintListData={sprintList.data}
                    sprintListLoading={sprintList.loading}
                    value={targetSprintId}
                    onChange={setTargetSprintId}
                    formId={formId}
                    ariaLabel="Add to sprint"
                  />
                </div>
              )}
              <Button
                type="button"
                onClick={() => void handleAiSend()}
                disabled={aiSending || !aiInput.trim()}
              >
                {aiSending ? "Sending…" : "Send"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleSwitchToFallback(aiInput || "")}
                title="Use local templates instead"
              >
                Local templates
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Draft cards — shown once AI returns drafts */}
        {draft && (phase === "preview" || phase === "creating") && (
          <>
            {createError && (
              <Alert variant="destructive" role="alert" className="mb-4 mt-4">
                <AlertDescription>
                  <p className="font-bold">
                    Failed to create tickets — {createError.code}
                  </p>
                  <p>{createError.message}</p>
                  {createError.code === "BRIDGE_DOWN" && (
                    <code className="block font-mono bg-background border border-destructive/30 rounded px-2 py-1 mt-2 text-[0.8125rem] w-fit">
                      npm run dev:jira:http
                    </code>
                  )}
                </AlertDescription>
              </Alert>
            )}

            {/* Visual separator between AI conversation zone and draft editing zone */}
            <div className="flex items-center gap-3 mt-5 mb-4">
              <Separator className="flex-1" />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Draft Preview
              </span>
              <Separator className="flex-1" />
            </div>

            <DraftPreview draft={draft} onChangeDraft={setDraft} formId={formId} />

            {/* v1.12 (ADR-023): comment + regenerate the PO+Dev pair via the conversation */}
            <div className="mt-3">
              <RefineDraftControl
                busy={aiSending}
                placeholder="Comment to refine both tickets (e.g. 'make the dev checklist shorter'), then regenerate…"
                onRegenerate={(c) => void handleAiSend(c)}
              />
            </div>

            <div className="flex gap-3 mt-5">
              <Button
                type="button"
                onClick={() => void handleCreate()}
                disabled={phase === "creating"}
              >
                {phase === "creating" ? "Creating…" : "Create in Jira"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleReset}
                disabled={phase === "creating"}
              >
                Start over
              </Button>
            </div>
          </>
        )}
      </div>
    );
  }

  // ── Render: Fallback (v1.0 deterministic form) ────────────────────────────

  return (
    <div className="max-w-5xl">
      <div className="flex items-center gap-3 flex-wrap mb-5">
        <h2 className="text-2xl font-bold">Ticket Generator</h2>
        {/* v1.2: "Use AI drafting" button in header when AI is available but forceFallback is on */}
        {!aiGenuinelyDisabled && (
          <Button
            type="button"
            onClick={() => void handleUseAiDrafting()}
          >
            Use AI drafting
          </Button>
        )}
      </div>

      {/* v1.2: Fallback banner — two variants based on whether AI is genuinely disabled */}
      {fallbackBannerVisible && (
        <FallbackBanner
          onDismiss={() => setFallbackBannerVisible(false)}
          aiGenuinelyDisabled={aiGenuinelyDisabled}
          onUseAi={!aiGenuinelyDisabled ? () => void handleUseAiDrafting() : undefined}
        />
      )}

      {/* Form */}
      {phase === "form" && (
        <Card className="mb-6 shadow-sm">
          <CardHeader className="pb-3">
            <h3 className="text-lg font-bold">New Ticket Pair</h3>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={handleGenerate}
              aria-label="Ticket generator form"
              noValidate
              className="space-y-4"
            >
              {/* Feature description */}
              <div>
                {/* a11y: explicit label via htmlFor */}
                <Label htmlFor={`${formId}-desc`} className="text-sm font-semibold mb-1.5 block">
                  Feature description <span className="text-destructive ml-0.5" aria-hidden="true">*</span>
                </Label>
                <Textarea
                  id={`${formId}-desc`}
                  value={form.featureDescription}
                  onChange={(e) => setForm((f) => ({ ...f, featureDescription: e.target.value }))}
                  placeholder="Describe the feature in plain English — e.g. 'Password reset via email with secure token'"
                  aria-required="true"
                  aria-describedby={validationError ? `${formId}-desc-err` : undefined}
                  rows={4}
                  className={cn(
                    validationError && "border-error ring-2 ring-error/50 focus-visible:ring-error"
                  )}
                />
                {validationError && (
                  // a11y: role="alert" + helper text tied by aria-describedby
                  <p id={`${formId}-desc-err`} className="text-xs text-error mt-1 flex items-center gap-1" role="alert">
                    {validationError}
                  </p>
                )}
              </div>

              {/* Story points */}
              <div>
                <Label htmlFor={`${formId}-pts`} className="text-sm font-semibold mb-1.5 block">
                  Story points
                </Label>
                <Input
                  id={`${formId}-pts`}
                  type="number"
                  min={0}
                  className="w-28"
                  value={form.storyPoints}
                  onChange={(e) => setForm((f) => ({ ...f, storyPoints: e.target.value }))}
                  placeholder="e.g. 5"
                />
                <p className="text-xs text-muted-foreground mt-1">Optional. Applied to the PO story.</p>
              </div>

              {/* Technical notes */}
              <div>
                <Label htmlFor={`${formId}-notes`} className="text-sm font-semibold mb-1.5 block">
                  Technical notes
                </Label>
                <Textarea
                  id={`${formId}-notes`}
                  value={form.technicalNotes}
                  onChange={(e) => setForm((f) => ({ ...f, technicalNotes: e.target.value }))}
                  placeholder="Optional: specific implementation constraints, API endpoints, tech stack notes…"
                  rows={3}
                />
                <p className="text-xs text-muted-foreground mt-1">Optional. Added to the Dev task implementation notes.</p>
              </div>

              {/* v1.6 (ADR-017): two sprint selects when boards available; fallback single */}
              {boards !== null ? (
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="flex-1">
                    <TargetSprintSelect
                      sprintListData={poSprintList.data}
                      sprintListLoading={poSprintList.loading}
                      value={poTargetSprintId}
                      onChange={setPoTargetSprintId}
                      formId={`${formId}-po`}
                      label="PO sprint"
                      ariaLabel="PO story sprint"
                    />
                  </div>
                  <div className="flex-1">
                    <TargetSprintSelect
                      sprintListData={devSprintList.data}
                      sprintListLoading={devSprintList.loading}
                      value={devTargetSprintId}
                      onChange={setDevTargetSprintId}
                      formId={`${formId}-dev`}
                      label="Dev sprint"
                      ariaLabel="Dev task sprint"
                    />
                  </div>
                </div>
              ) : (
                /* v1.4 fallback: single Dev sprint select (older bridge) */
                <TargetSprintSelect
                  sprintListData={sprintList.data}
                  sprintListLoading={sprintList.loading}
                  value={targetSprintId}
                  onChange={setTargetSprintId}
                  formId={formId}
                  ariaLabel="Add to sprint"
                />
              )}

              <div className="flex gap-3">
                <Button type="submit">
                  Generate drafts
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Preview */}
      {(phase === "preview" || phase === "creating") && draft && (
        <>
          {createError && (
            <Alert variant="destructive" role="alert" className="mb-5">
              <AlertDescription>
                <p className="font-bold">
                  Failed to create tickets — {createError.code}
                </p>
                <p>{createError.message}</p>
                {createError.code === "BRIDGE_DOWN" && (
                  <code className="block font-mono bg-background border border-destructive/30 rounded px-2 py-1 mt-2 text-[0.8125rem] w-fit">
                    npm run dev:jira:http
                  </code>
                )}
              </AlertDescription>
            </Alert>
          )}

          <DraftPreview draft={draft} onChangeDraft={setDraft} formId={formId} />

          <div className="flex gap-3 mt-5">
            <Button
              type="button"
              onClick={() => void handleCreate()}
              disabled={phase === "creating"}
            >
              {phase === "creating" ? "Creating…" : "Create in Jira"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPhase("form")}
              disabled={phase === "creating"}
            >
              Back
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleReset}
              disabled={phase === "creating"}
            >
              Start over
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
