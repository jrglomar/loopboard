// Linking — bulk-create Dev tasks for existing PO stories (v1.11, ADR-022)
//
// Workflow: pick a PO sprint + a target Dev sprint → multi-select PO tickets
// (each showing its existing linked Dev ticket, "one or none") → generate an AI
// plan (one Dev draft per PO) → review/edit → "Create all" with a live status log.
//
// Backend: get_linked_issues (existing links), POST /api/ai/plan-dev-tickets (the
// plan), create_dev_ticket (looped client-side for per-item ✓/✗). a11y: labeled
// checkboxes/selects, aria-live status log.

import { useState, useEffect, useId, useMemo, useCallback } from "react";
import {
  Link2, Sparkles, Loader2, CheckCircle2, XCircle, ExternalLink, ListChecks, AlertCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useBoards } from "../lib/boards";
import { useActiveSprint, useSprintList, createLinkedDevTicket } from "../hooks/useJira";
import { getLinkedIssues, getIssueDescriptions } from "../lib/linkClient";
import { getAiStatus, aiPlanDevTickets } from "../lib/aiClient";
import { RefineDraftControl } from "../components/RefineDraftControl";
import { buildDraftPair } from "../lib/ticketTemplates";
import { formatPoints } from "../lib/format";
import type { McpError } from "../lib/mcpClient";
import type {
  IssueSummary, SprintRef, LinkedIssue, PlanDevTicketItem, AiStatus,
} from "../lib/types";

type Phase = "select" | "plan" | "creating" | "done";

interface RowResult {
  poKey: string;
  status: "pending" | "ok" | "error";
  devKey?: string;
  devUrl?: string;
  linkedTo?: string;
  linkWarning?: string;
  sprintWarning?: string;
  error?: string;
}

function flattenIssues(data: ReturnType<typeof useActiveSprint>["data"]): IssueSummary[] {
  if (!data) return [];
  const b = data.issuesByStatus;
  return [...b.todo, ...b.inprogress, ...b.codereview, ...b.done];
}

const selectCls =
  "h-9 w-full max-w-xs text-xs px-2 border border-border rounded-md bg-background text-foreground font-[inherit] cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 transition-colors hover:border-ring disabled:opacity-50 disabled:cursor-not-allowed";

// v1.14 (ADR-025): cap each PO description fed to the AI so the prompt stays bounded.
const PO_DESC_CAP = 4000;
function capDesc(text: string): string {
  const t = (text ?? "").trim();
  return t.length <= PO_DESC_CAP ? t : t.slice(0, PO_DESC_CAP) + "\n… (truncated)";
}

export function Linking() {
  const formId = useId();
  const { boards, loading: boardsLoading } = useBoards();

  const poSprintList = useSprintList("all", boards?.po.id);
  const devSprintList = useSprintList("all", boards?.dev.id);

  const [poSprintId, setPoSprintId] = useState<number | undefined>(undefined);
  const [devSprintId, setDevSprintId] = useState<number | undefined>(undefined);

  const poTicketsState = useActiveSprint(boards?.po.id, poSprintId ?? null);
  const poTickets = useMemo(() => flattenIssues(poTicketsState.data), [poTicketsState.data]);

  // Existing PO→Dev links (badged in the list)
  const [linksMap, setLinksMap] = useState<Record<string, LinkedIssue[]>>({});
  const [linksLoading, setLinksLoading] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<Phase>("select");
  const [plan, setPlan] = useState<PlanDevTicketItem[]>([]);
  // v1.14: fetched PO descriptions (by key), reused by Generate + per-draft Regenerate.
  const [descMap, setDescMap] = useState<Record<string, string>>({});
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [results, setResults] = useState<RowResult[]>([]);

  const [aiStatus, setAiStatus] = useState<AiStatus>({ enabled: false, provider: null, model: null });

  useEffect(() => {
    getAiStatus().then(setAiStatus).catch(() => setAiStatus({ enabled: false, provider: null, model: null }));
  }, []);

  // Fetch existing Dev links for the PO sprint's tickets; default-select the
  // tickets WITHOUT a Dev link (the natural bulk-create candidates).
  useEffect(() => {
    if (poSprintId == null || poTickets.length === 0) {
      setLinksMap({});
      setSelected(new Set());
      return;
    }
    const keys = poTickets.map((t) => t.key);
    let cancelled = false;
    setLinksLoading(true);
    getLinkedIssues(keys)
      .then((res) => {
        if (cancelled) return;
        setLinksMap(res.links);
        const withoutLink = keys.filter((k) => (res.links[k] ?? []).length === 0);
        setSelected(new Set(withoutLink));
      })
      .catch(() => {
        if (!cancelled) { setLinksMap({}); setSelected(new Set(keys)); }
      })
      .finally(() => { if (!cancelled) setLinksLoading(false); });
    return () => { cancelled = true; };
  }, [poSprintId, poTickets]);

  const toggle = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const linklessKeys = useMemo(
    () => poTickets.filter((t) => (linksMap[t.key] ?? []).length === 0).map((t) => t.key),
    [poTickets, linksMap]
  );

  // ── Generate the plan (AI, or deterministic template fallback) ───────────────
  async function handleGenerate() {
    const chosen = poTickets.filter((t) => selected.has(t.key));
    if (chosen.length === 0) return;
    setGenerating(true);
    setPlanError(null);
    setAiNote(null);

    // v1.14 (ADR-025): pull each selected PO's own description so the Dev task is drafted
    // from real acceptance criteria/scope, not just the one-line summary. Non-fatal.
    let descByKey: Record<string, string> = {};
    try {
      const res = await getIssueDescriptions(chosen.map((t) => t.key));
      descByKey = res.descriptions;
    } catch {
      descByKey = {};
    }
    setDescMap(descByKey);
    const descOf = (key: string) => capDesc(descByKey[key] ?? "");

    const fallback = (): PlanDevTicketItem[] =>
      chosen.map((t) => {
        const d = buildDraftPair(t.summary).dev;
        const src = descOf(t.key);
        const devDescription = src
          ? `## Source PO story (${t.key})\n\n${src}\n\n${d.description}`
          : d.description;
        return { poKey: t.key, devSummary: d.summary, devDescription };
      });

    try {
      if (aiStatus.enabled) {
        const res = await aiPlanDevTickets({
          poStories: chosen.map((t) => {
            const description = descOf(t.key);
            return description
              ? { key: t.key, summary: t.summary, description }
              : { key: t.key, summary: t.summary };
          }),
        });
        // Reconcile to the selection by poKey; fall back per-PO for any omission.
        const byKey = new Map(res.items.map((i) => [i.poKey, i]));
        const items: PlanDevTicketItem[] = chosen.map((t) => {
          const it = byKey.get(t.key);
          if (it) return it;
          const d = buildDraftPair(t.summary).dev;
          return { poKey: t.key, devSummary: d.summary, devDescription: d.description };
        });
        setPlan(items);
        setAiNote(res.assistantMessage);
      } else {
        setPlan(fallback());
        setAiNote("AI is off — drafted from local templates. Edit each task before creating.");
      }
      setPhase("plan");
    } catch (err: unknown) {
      // AI error/unavailable → deterministic fallback so the workflow never blocks
      const e = err as McpError;
      setPlan(fallback());
      setAiNote(
        e.code === "AI_UNAVAILABLE"
          ? "AI is off — drafted from local templates. Edit each task before creating."
          : `AI error (${e.code ?? "UNKNOWN"}) — drafted from local templates instead.`
      );
      setPhase("plan");
    } finally {
      setGenerating(false);
    }
  }

  function editPlanItem(poKey: string, patch: Partial<PlanDevTicketItem>) {
    setPlan((prev) => prev.map((p) => (p.poKey === poKey ? { ...p, ...patch } : p)));
  }

  // ── Regenerate one plan item from a reviewer comment (v1.12, ADR-023) ────────
  const [regeneratingKey, setRegeneratingKey] = useState<string | null>(null);
  async function regenerateItem(poKey: string, comment: string) {
    const po = poTickets.find((t) => t.key === poKey);
    const current = plan.find((p) => p.poKey === poKey);
    if (!po || !current) return;
    setRegeneratingKey(poKey);
    try {
      const instructions =
        `A reviewer left this comment on the current Dev task draft: "${comment}". ` +
        `Current draft summary: "${current.devSummary}". ` +
        `Current draft description:\n${current.devDescription}\n\n` +
        `Rewrite the Dev task to address the comment, keeping what still applies.`;
      const description = capDesc(descMap[po.key] ?? "");
      const res = await aiPlanDevTickets({
        poStories: [
          description
            ? { key: po.key, summary: po.summary, description }
            : { key: po.key, summary: po.summary },
        ],
        instructions,
      });
      const item = res.items.find((i) => i.poKey === poKey) ?? res.items[0];
      if (item) editPlanItem(poKey, { devSummary: item.devSummary, devDescription: item.devDescription });
    } catch {
      // Keep the current draft on failure — non-fatal.
    } finally {
      setRegeneratingKey(null);
    }
  }

  // ── Bulk create (sequential so the log streams + we don't hammer Jira) ────────
  async function handleCreateAll() {
    setPhase("creating");
    setResults(plan.map((p) => ({ poKey: p.poKey, status: "pending" as const })));
    for (let i = 0; i < plan.length; i++) {
      const item = plan[i]!;
      try {
        const dev = await createLinkedDevTicket({
          summary: item.devSummary.trim() || item.poKey,
          description: item.devDescription,
          linkedPoTicketKey: item.poKey,
          ...(devSprintId !== undefined ? { sprintId: devSprintId } : {}),
        });
        setResults((prev) => prev.map((r, idx) => idx === i ? {
          poKey: item.poKey, status: "ok", devKey: dev.key, devUrl: dev.url,
          linkedTo: dev.linkedTo, linkWarning: dev.linkWarning, sprintWarning: dev.sprintWarning,
        } : r));
      } catch (err: unknown) {
        const e = err as McpError;
        setResults((prev) => prev.map((r, idx) => idx === i ? {
          poKey: item.poKey, status: "error", error: e.message ?? String(err),
        } : r));
      }
    }
    setPhase("done");
  }

  // v1.13 P0: re-run ONLY the rows that failed (by poKey), leaving successes alone.
  async function handleRetryFailed() {
    const failed = new Set(results.filter((r) => r.status === "error").map((r) => r.poKey));
    if (failed.size === 0) return;
    setPhase("creating");
    setResults((prev) => prev.map((r) => failed.has(r.poKey) ? { poKey: r.poKey, status: "pending" } : r));
    for (const item of plan) {
      if (!failed.has(item.poKey)) continue;
      try {
        const dev = await createLinkedDevTicket({
          summary: item.devSummary.trim() || item.poKey,
          description: item.devDescription,
          linkedPoTicketKey: item.poKey,
          ...(devSprintId !== undefined ? { sprintId: devSprintId } : {}),
        });
        setResults((prev) => prev.map((r) => r.poKey === item.poKey ? {
          poKey: item.poKey, status: "ok", devKey: dev.key, devUrl: dev.url,
          linkedTo: dev.linkedTo, linkWarning: dev.linkWarning, sprintWarning: dev.sprintWarning,
        } : r));
      } catch (err: unknown) {
        const e = err as McpError;
        setResults((prev) => prev.map((r) => r.poKey === item.poKey ? {
          poKey: item.poKey, status: "error", error: e.message ?? String(err),
        } : r));
      }
    }
    setPhase("done");
  }

  function reset() {
    setPhase("select");
    setPlan([]);
    setDescMap({});
    setResults([]);
    setAiNote(null);
    setPlanError(null);
  }

  // ── Render helpers ────────────────────────────────────────────────────────────
  const poSprints: SprintRef[] = poSprintList.data
    ? [...poSprintList.data.active, ...poSprintList.data.future, ...poSprintList.data.closed] : [];
  const devSprints: SprintRef[] = devSprintList.data
    ? [...devSprintList.data.active, ...devSprintList.data.future, ...devSprintList.data.closed] : [];
  const devSprintName = devSprints.find((s) => s.id === devSprintId)?.name;

  const okCount = results.filter((r) => r.status === "ok").length;
  const errCount = results.filter((r) => r.status === "error").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link2 className="h-5 w-5 text-primary" aria-hidden="true" />
        <h2 className="text-lg font-semibold">Linking — bulk Dev tickets from PO stories</h2>
      </div>

      {/* ── Sprint context ─────────────────────────────────────────────────── */}
      <Card className="shadow-sm">
        <CardContent className="pt-5">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label htmlFor={`${formId}-po`} className="text-xs font-semibold">PO board sprint (source)</Label>
              {boardsLoading ? <Skeleton className="h-9 w-48" /> : (
                <select
                  id={`${formId}-po`} className={selectCls} value={poSprintId ?? ""}
                  onChange={(e) => { const v = e.target.value; setPoSprintId(v === "" ? undefined : parseInt(v, 10)); reset(); }}
                  disabled={poSprintList.loading || poSprints.length === 0} aria-label="PO board sprint"
                >
                  <option value="">Select a PO sprint…</option>
                  {(["active", "future", "closed"] as const).map((g) =>
                    poSprintList.data && poSprintList.data[g].length > 0 ? (
                      <optgroup key={g} label={g[0]!.toUpperCase() + g.slice(1)}>
                        {poSprintList.data[g].map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
                      </optgroup>
                    ) : null
                  )}
                </select>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${formId}-dev`} className="text-xs font-semibold">Dev board sprint (target)</Label>
              {boardsLoading ? <Skeleton className="h-9 w-48" /> : (
                <select
                  id={`${formId}-dev`} className={selectCls} value={devSprintId ?? ""}
                  onChange={(e) => { const v = e.target.value; setDevSprintId(v === "" ? undefined : parseInt(v, 10)); }}
                  disabled={devSprintList.loading || devSprints.length === 0} aria-label="Dev board sprint"
                >
                  <option value="">Backlog / no sprint</option>
                  {(["active", "future"] as const).map((g) =>
                    devSprintList.data && devSprintList.data[g].length > 0 ? (
                      <optgroup key={g} label={g[0]!.toUpperCase() + g.slice(1)}>
                        {devSprintList.data[g].map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
                      </optgroup>
                    ) : null
                  )}
                </select>
              )}
            </div>
            {aiStatus.enabled && (
              <Badge variant="outline" className="text-[0.6875rem] font-bold border-primary text-primary bg-primary/10 mb-1">
                AI: {aiStatus.provider} · {aiStatus.model}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Phase: select ──────────────────────────────────────────────────── */}
      {phase === "select" && (
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h3 className="text-base font-semibold flex items-center gap-2">
                <ListChecks className="h-4 w-4 text-primary" aria-hidden="true" />
                Select PO stories {selected.size > 0 && <span className="text-muted-foreground font-normal">({selected.size} selected)</span>}
              </h3>
              {poSprintId !== undefined && poTickets.length > 0 && (
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" className="h-7 text-xs"
                    onClick={() => setSelected(new Set(linklessKeys))}
                    aria-label="Select all PO stories without a Dev link">
                    Select link-less ({linklessKeys.length})
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="h-7 text-xs"
                    onClick={() => setSelected(new Set())}>Clear</Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {poSprintId === undefined ? (
              <p className="text-sm text-muted-foreground">Pick a PO sprint above to list its stories.</p>
            ) : poTicketsState.loading ? (
              <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
            ) : poTickets.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tickets in this PO sprint.</p>
            ) : (
              <>
                {linksLoading && (
                  <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Checking existing Dev links…
                  </p>
                )}
                <ul role="list" className="divide-y divide-border/50">
                  {poTickets.map((t) => {
                    const links = linksMap[t.key] ?? [];
                    const checked = selected.has(t.key);
                    return (
                      <li key={t.key} className="flex items-start gap-3 py-2">
                        <input
                          type="checkbox" checked={checked} onChange={() => toggle(t.key)}
                          id={`${formId}-cb-${t.key}`} className="mt-1 h-4 w-4 cursor-pointer accent-[hsl(var(--primary))]"
                          aria-label={`Select ${t.key} ${t.summary}`}
                        />
                        <label htmlFor={`${formId}-cb-${t.key}`} className="flex-1 min-w-0 cursor-pointer">
                          <span className="flex items-center gap-2 flex-wrap">
                            <a href={t.url} target="_blank" rel="noopener noreferrer"
                              className="font-mono text-xs font-bold text-primary hover:underline" onClick={(e) => e.stopPropagation()}
                              aria-label={`Open ${t.key} in Jira`}>{t.key}</a>
                            {t.storyPoints != null && <span className="text-[0.6875rem] text-muted-foreground tabular-nums">{formatPoints(t.storyPoints)} pts</span>}
                            {links.length > 0 ? (
                              <Badge variant="outline" className="text-[0.625rem] border-success-border text-success bg-success-bg">
                                → {links.map((l) => l.key).join(", ")}
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[0.625rem] text-muted-foreground">no Dev link</Badge>
                            )}
                          </span>
                          <span className="block text-sm text-foreground truncate">{t.summary}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-4 flex items-center gap-3">
                  <Button type="button" onClick={() => void handleGenerate()} disabled={selected.size === 0 || generating}>
                    {generating ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" aria-hidden="true" />Planning…</>
                      : <><Sparkles className="h-4 w-4 mr-1.5" aria-hidden="true" />{aiStatus.enabled ? "Generate plan with AI" : "Build plan"} ({selected.size})</>}
                  </Button>
                  {planError && <span className="text-xs text-destructive">{planError}</span>}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Phase: plan (review/edit) ──────────────────────────────────────── */}
      {phase === "plan" && (
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <h3 className="text-base font-semibold">Plan — {plan.length} Dev task{plan.length !== 1 ? "s" : ""} to create</h3>
            {aiNote && <p className="text-xs text-muted-foreground mt-1">{aiNote}</p>}
          </CardHeader>
          <CardContent className="space-y-4">
            {plan.map((item) => (
              <div key={item.poKey} className="rounded-md border border-border bg-muted/20 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-xs text-muted-foreground">New Dev task → linked to <span className="font-mono font-semibold text-foreground">{item.poKey}</span></p>
                  {(descMap[item.poKey] ?? "").trim().length > 0 ? (
                    <Badge variant="outline" className="text-[0.625rem] border-success-border text-success bg-success-bg">
                      drafted from PO description
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[0.625rem] text-warning-foreground border-warning-border gap-1">
                      <AlertCircle className="h-3 w-3" aria-hidden="true" /> PO has no description — drafted from title
                    </Badge>
                  )}
                </div>
                <div>
                  <Label htmlFor={`${formId}-ps-${item.poKey}`} className="text-xs font-semibold mb-1 block">Summary</Label>
                  <Input id={`${formId}-ps-${item.poKey}`} value={item.devSummary} maxLength={255}
                    onChange={(e) => editPlanItem(item.poKey, { devSummary: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor={`${formId}-pd-${item.poKey}`} className="text-xs font-semibold mb-1 block">Description</Label>
                  <Textarea id={`${formId}-pd-${item.poKey}`} value={item.devDescription} rows={6}
                    className="font-mono text-[0.8125rem]"
                    onChange={(e) => editPlanItem(item.poKey, { devDescription: e.target.value })} />
                </div>
                {aiStatus.enabled && (
                  <RefineDraftControl
                    busy={regeneratingKey === item.poKey}
                    labelFor={item.poKey}
                    onRegenerate={(c) => void regenerateItem(item.poKey, c)}
                  />
                )}
              </div>
            ))}
            <div className="flex items-center gap-3">
              <Button type="button" onClick={() => void handleCreateAll()} disabled={plan.length === 0}>
                Create all ({plan.length}){devSprintName ? ` → ${devSprintName}` : ""}
              </Button>
              <Button type="button" variant="outline" onClick={() => setPhase("select")}>Back to selection</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Phase: creating / done (status log) ────────────────────────────── */}
      {(phase === "creating" || phase === "done") && (
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <h3 className="text-base font-semibold flex items-center gap-2">
              {phase === "creating" ? <><Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />Creating Dev tickets…</>
                : <>Done — <span className="text-success">{okCount} created</span>{errCount > 0 && <span className="text-destructive">, {errCount} failed</span>}</>}
            </h3>
          </CardHeader>
          <CardContent>
            <ul role="status" aria-live="polite" className="space-y-1.5">
              {results.map((r) => (
                <li key={r.poKey} className="flex items-start gap-2 text-sm">
                  {r.status === "pending" && <Loader2 className="h-4 w-4 mt-0.5 animate-spin text-muted-foreground flex-shrink-0" aria-hidden="true" />}
                  {r.status === "ok" && <CheckCircle2 className="h-4 w-4 mt-0.5 text-success flex-shrink-0" aria-hidden="true" />}
                  {r.status === "error" && <XCircle className="h-4 w-4 mt-0.5 text-destructive flex-shrink-0" aria-hidden="true" />}
                  <span className="min-w-0">
                    <span className="font-mono font-semibold">{r.poKey}</span>{" "}
                    {r.status === "pending" && <span className="text-muted-foreground">queued…</span>}
                    {r.status === "ok" && (
                      <>→{" "}
                        <a href={r.devUrl} target="_blank" rel="noopener noreferrer"
                          className="font-mono font-bold text-primary hover:underline inline-flex items-center gap-0.5"
                          aria-label={`Open ${r.devKey} in Jira`}>{r.devKey}<ExternalLink className="h-3 w-3" aria-hidden="true" /></a>
                        {r.linkedTo ? <span className="text-muted-foreground"> · linked</span> : r.linkWarning ? <span className="text-warning-foreground"> · link: {r.linkWarning}</span> : null}
                        {r.sprintWarning && <span className="text-warning-foreground"> · sprint: {r.sprintWarning}</span>}
                      </>
                    )}
                    {r.status === "error" && <span className="text-destructive">failed — {r.error}</span>}
                  </span>
                </li>
              ))}
            </ul>
            {phase === "done" && (
              <div className="mt-4 flex gap-2">
                {errCount > 0 && (
                  <Button type="button" onClick={() => void handleRetryFailed()}>
                    Retry failed ({errCount})
                  </Button>
                )}
                <Button type="button" variant="outline" onClick={reset}>Start over</Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {boards === null && !boardsLoading && (
        <Alert variant="destructive" role="alert">
          <AlertDescription className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4" aria-hidden="true" /> Jira bridge is offline — start it with <code className="font-mono">npm run dev:jira:http</code>.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
