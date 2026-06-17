// LinkDevTicketCard — create a Dev Task for an EXISTING PO story (v1.10, ADR-021)
//
// Unlike TicketGen (which creates a NEW PO+Dev pair), this links a new Dev Task to
// a PO story that already exists:
//   1. pick a PO board sprint            (list_sprints on boards.po.id)
//   2. pick one of its tickets           (get_active_sprint(po.id, sprintId))
//   3. edit a Dev summary + description  (pre-seeded from the PO story; optional AI)
//   4. pick a Dev board sprint           (list_sprints on boards.dev.id)
//   5. Create → create_dev_ticket({ summary, description, linkedPoTicketKey, sprintId })
//
// Backend is unchanged — create_dev_ticket already supports linkedPoTicketKey + sprintId.
// a11y: native <select>s (ADR-009), labeled controls, role="status" success/alerts.

import { useState, useEffect, useId, useMemo } from "react";
import { GitMerge, Sparkles, Loader2, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useActiveSprint, useSprintList, createLinkedDevTicket } from "../hooks/useJira";
import { useBoards } from "../lib/boards";
import { getAiStatus, aiDraftTickets } from "../lib/aiClient";
import { buildDraftPair } from "../lib/ticketTemplates";
import { formatPoints } from "../lib/format";
import type { McpError } from "../lib/mcpClient";
import type {
  IssueSummary,
  SprintRef,
  CreateDevTicketOutput,
  AiStatus,
} from "../lib/types";

export interface LinkDevTicketCardProps {
  /** Pre-select this Dev sprint (e.g. the Planning context's Dev sprint). Optional. */
  initialDevSprintId?: number;
}

interface SuccessState {
  dev: CreateDevTicketOutput;
  poKey: string;
  devSprintName?: string;
}

// Flatten a sprint's buckets into one ordered list.
function flattenIssues(data: ReturnType<typeof useActiveSprint>["data"]): IssueSummary[] {
  if (!data) return [];
  const b = data.issuesByStatus;
  return [...b.todo, ...b.inprogress, ...b.codereview, ...b.done];
}

export function LinkDevTicketCard({ initialDevSprintId }: LinkDevTicketCardProps = {}) {
  const formId = useId();
  const { boards } = useBoards();

  // Sprint lists for each board (active + future + closed)
  const poSprintList = useSprintList("all", boards?.po.id);
  const devSprintList = useSprintList("all", boards?.dev.id);

  // ── Selections ──────────────────────────────────────────────────────────────
  const [poSprintId, setPoSprintId] = useState<number | undefined>(undefined);
  const [poTicketKey, setPoTicketKey] = useState<string>("");
  const [devSprintId, setDevSprintId] = useState<number | undefined>(initialDevSprintId);

  // PO sprint's tickets (only fetched once a PO sprint is chosen)
  const poTicketsState = useActiveSprint(boards?.po.id, poSprintId ?? null);
  const poTickets = useMemo(() => flattenIssues(poTicketsState.data), [poTicketsState.data]);
  const selectedPoTicket = poTickets.find((t) => t.key === poTicketKey) ?? null;

  // ── Dev draft fields ─────────────────────────────────────────────────────────
  const [devSummary, setDevSummary] = useState("");
  const [devDescription, setDevDescription] = useState("");

  // ── AI status (for the optional "Generate with AI" button) ────────────────────
  const [aiStatus, setAiStatus] = useState<AiStatus>({ enabled: false, provider: null, model: null });
  const [aiGenerating, setAiGenerating] = useState(false);

  // ── Create flow ────────────────────────────────────────────────────────────
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<McpError | null>(null);
  const [success, setSuccess] = useState<SuccessState | null>(null);

  useEffect(() => {
    getAiStatus()
      .then(setAiStatus)
      .catch(() => setAiStatus({ enabled: false, provider: null, model: null }));
  }, []);

  // When a PO ticket is picked, pre-seed the Dev draft from it (only if untouched).
  function handlePickPoTicket(key: string) {
    setPoTicketKey(key);
    const t = poTickets.find((i) => i.key === key);
    if (t) {
      setDevSummary((prev) => (prev.trim() === "" ? t.summary : prev));
      setDevDescription((prev) =>
        prev.trim() === ""
          ? `Implementation task for ${t.key} — ${t.summary}\n\n## Implementation\n- \n\n## Acceptance criteria\n- Meets the linked PO story ${t.key}`
          : prev
      );
    }
  }

  async function handleGenerateAi() {
    if (!selectedPoTicket) return;
    setAiGenerating(true);
    setCreateError(null);
    try {
      const sp =
        selectedPoTicket.storyPoints != null ? selectedPoTicket.storyPoints : undefined;
      const res = await aiDraftTickets({
        messages: [
          {
            role: "user",
            content: `Write the developer Task for this existing PO story.\nPO ${selectedPoTicket.key}: ${selectedPoTicket.summary}`,
          },
        ],
        storyPoints: sp,
      });
      setDevSummary(res.dev.summary);
      setDevDescription(res.dev.description);
    } catch {
      // AI unavailable/errored → deterministic template from the PO summary
      const pair = buildDraftPair(selectedPoTicket.summary);
      setDevSummary(pair.dev.summary);
      setDevDescription(pair.dev.description);
    } finally {
      setAiGenerating(false);
    }
  }

  async function handleCreate() {
    if (!poTicketKey || devSummary.trim() === "") return;
    setCreating(true);
    setCreateError(null);
    try {
      const dev = await createLinkedDevTicket({
        summary: devSummary.trim(),
        description: devDescription,
        linkedPoTicketKey: poTicketKey,
        ...(devSprintId !== undefined ? { sprintId: devSprintId } : {}),
      });
      const allDevSprints: SprintRef[] = devSprintList.data
        ? [...devSprintList.data.active, ...devSprintList.data.future, ...devSprintList.data.closed]
        : [];
      const devSprint = devSprintId !== undefined
        ? allDevSprints.find((s) => s.id === devSprintId)
        : undefined;
      setSuccess({ dev, poKey: poTicketKey, devSprintName: devSprint?.name });
    } catch (err: unknown) {
      setCreateError(err as McpError);
    } finally {
      setCreating(false);
    }
  }

  function handleReset() {
    setPoTicketKey("");
    setDevSummary("");
    setDevDescription("");
    setCreateError(null);
    setSuccess(null);
  }

  const cardHeader = (
    <CardHeader className="pb-2">
      <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
        <GitMerge className="h-4 w-4 text-primary" aria-hidden="true" />
        Dev ticket for an existing PO story
      </h3>
      <p className="text-xs text-muted-foreground">
        Pick a PO story, then create a linked Dev task in a Dev sprint.
      </p>
    </CardHeader>
  );

  // ── Success ──────────────────────────────────────────────────────────────────
  if (success) {
    return (
      <Card className="shadow-sm border-success-border bg-success-bg">
        {cardHeader}
        <CardContent>
          <div role="status" aria-live="polite" className="space-y-2">
            <p className="text-sm font-semibold text-success flex items-center gap-1.5">
              <span aria-hidden="true">✓</span> Dev task created
            </p>
            <p className="text-sm text-foreground">
              <a
                href={success.dev.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono font-bold text-primary hover:underline inline-flex items-center gap-1"
                aria-label={`Open ${success.dev.key} in Jira`}
              >
                {success.dev.key}
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>{" "}
              {success.dev.linkedTo ? (
                <>linked to <span className="font-mono font-semibold">{success.dev.linkedTo}</span></>
              ) : (
                <span className="text-warning-foreground">— link warning: {success.dev.linkWarning}</span>
              )}
              {success.devSprintName && !success.dev.sprintWarning && (
                <> · sprint <span className="font-semibold">{success.devSprintName}</span></>
              )}
            </p>
            {success.dev.sprintWarning && (
              <p className="text-xs text-warning-foreground">⚠ Sprint: {success.dev.sprintWarning}</p>
            )}
            <Button type="button" variant="outline" size="sm" onClick={handleReset} className="mt-1">
              Create another
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Form ─────────────────────────────────────────────────────────────────────
  const poSprints = poSprintList.data
    ? [...poSprintList.data.active, ...poSprintList.data.future, ...poSprintList.data.closed]
    : [];
  const devSprints = devSprintList.data
    ? [...devSprintList.data.active, ...devSprintList.data.future, ...devSprintList.data.closed]
    : [];

  const selectCls =
    "h-9 w-full text-xs px-2 border border-border rounded-md bg-background text-foreground font-[inherit] cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 transition-colors hover:border-ring disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <Card className="shadow-sm">
      {cardHeader}
      <CardContent className="space-y-4">
        {createError && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>
              <p className="font-bold">Failed to create — {createError.code}</p>
              <p>{createError.message}</p>
              {createError.code === "BRIDGE_DOWN" && (
                <code className="block font-mono bg-background border border-destructive/30 rounded px-2 py-1 mt-2 text-[0.8125rem] w-fit">
                  npm run dev:jira:http
                </code>
              )}
            </AlertDescription>
          </Alert>
        )}

        {/* Step 1 + 2: PO sprint + PO ticket */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor={`${formId}-po-sprint`} className="text-xs font-semibold">
              PO board sprint
            </Label>
            <select
              id={`${formId}-po-sprint`}
              className={selectCls}
              value={poSprintId ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                setPoSprintId(v === "" ? undefined : parseInt(v, 10));
                setPoTicketKey("");
              }}
              disabled={poSprintList.loading || poSprints.length === 0}
              aria-label="PO board sprint"
            >
              <option value="">Select a PO sprint…</option>
              {poSprintList.data?.active && poSprintList.data.active.length > 0 && (
                <optgroup label="Active">
                  {poSprintList.data.active.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
                </optgroup>
              )}
              {poSprintList.data?.future && poSprintList.data.future.length > 0 && (
                <optgroup label="Future">
                  {poSprintList.data.future.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
                </optgroup>
              )}
              {poSprintList.data?.closed && poSprintList.data.closed.length > 0 && (
                <optgroup label="Closed">
                  {poSprintList.data.closed.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
                </optgroup>
              )}
            </select>
          </div>

          <div className="space-y-1">
            <Label htmlFor={`${formId}-po-ticket`} className="text-xs font-semibold">
              PO story to link
            </Label>
            <select
              id={`${formId}-po-ticket`}
              className={selectCls}
              value={poTicketKey}
              onChange={(e) => handlePickPoTicket(e.target.value)}
              disabled={poSprintId === undefined || poTicketsState.loading || poTickets.length === 0}
              aria-label="PO story to link"
            >
              <option value="">
                {poSprintId === undefined
                  ? "Select a sprint first"
                  : poTicketsState.loading
                    ? "Loading tickets…"
                    : poTickets.length === 0
                      ? "No tickets in this sprint"
                      : "Select a PO story…"}
              </option>
              {poTickets.map((t) => (
                <option key={t.key} value={t.key} title={t.summary}>
                  {t.key} — {t.summary.length > 60 ? t.summary.slice(0, 60) + "…" : t.summary}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Step 3: Dev draft (shown once a PO ticket is chosen) */}
        {selectedPoTicket && (
          <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-xs text-muted-foreground">
                New Dev task →{" "}
                <span className="font-mono font-semibold text-foreground">linked to {selectedPoTicket.key}</span>
                {selectedPoTicket.storyPoints != null && (
                  <> · {formatPoints(selectedPoTicket.storyPoints)} pts</>
                )}
              </p>
              {aiStatus.enabled && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void handleGenerateAi()}
                  disabled={aiGenerating}
                  className="h-7 text-xs"
                  aria-label="Generate the Dev task with AI"
                >
                  {aiGenerating ? (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" aria-hidden="true" />
                  ) : (
                    <Sparkles className="h-3 w-3 mr-1" aria-hidden="true" />
                  )}
                  Generate with AI
                </Button>
              )}
            </div>

            <div>
              <Label htmlFor={`${formId}-dev-sum`} className="text-xs font-semibold mb-1 block">
                Dev summary <span className="text-destructive" aria-hidden="true">*</span>
              </Label>
              <Input
                id={`${formId}-dev-sum`}
                value={devSummary}
                onChange={(e) => setDevSummary(e.target.value)}
                maxLength={255}
                placeholder="Dev task summary"
              />
            </div>
            <div>
              <Label htmlFor={`${formId}-dev-desc`} className="text-xs font-semibold mb-1 block">
                Dev description
              </Label>
              <Textarea
                id={`${formId}-dev-desc`}
                value={devDescription}
                onChange={(e) => setDevDescription(e.target.value)}
                rows={8}
                className="font-mono text-[0.8125rem]"
              />
            </div>

            {/* Step 4: Dev sprint */}
            <div className="space-y-1 max-w-xs">
              <Label htmlFor={`${formId}-dev-sprint`} className="text-xs font-semibold">
                Dev board sprint <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <select
                id={`${formId}-dev-sprint`}
                className={selectCls}
                value={devSprintId ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  setDevSprintId(v === "" ? undefined : parseInt(v, 10));
                }}
                disabled={devSprintList.loading || devSprints.length === 0}
                aria-label="Dev board sprint"
              >
                <option value="">Backlog / no sprint</option>
                {devSprintList.data?.active && devSprintList.data.active.length > 0 && (
                  <optgroup label="Active">
                    {devSprintList.data.active.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
                  </optgroup>
                )}
                {devSprintList.data?.future && devSprintList.data.future.length > 0 && (
                  <optgroup label="Future">
                    {devSprintList.data.future.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
                  </optgroup>
                )}
              </select>
            </div>

            {/* Step 5: Create */}
            <div className="flex gap-2 pt-1">
              <Button
                type="button"
                onClick={() => void handleCreate()}
                disabled={creating || devSummary.trim() === ""}
              >
                {creating ? "Creating…" : "Create Dev ticket"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
