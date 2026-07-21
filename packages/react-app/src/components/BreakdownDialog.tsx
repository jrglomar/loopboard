// BreakdownDialog — split an oversized PO story into new PO stories (v1.69, ADR-080)
//
// Opens from a Draft Capacity Plan chip's expanded editor ("Break down"). Creates
// 2-6 new PO stories in the SAME PO sprint via the existing create_po_ticket
// (§4.1 — storyPoints + sprintId already supported, no backend change), SEQUENTIALLY
// so the per-row status log stays truthful (the Linking page's resilient-bulk
// pattern, src/pages/Linking.tsx): pending -> creating -> created/error, with
// succeeded rows LOCKED — a retry only ever re-attempts a row that failed, so it
// never creates a duplicate. No PO<->PO Jira link is created (the configured
// JIRA_LINK_TYPE encodes PO->Dev dependency semantics, §4.2) — provenance is
// recorded in each new story's description instead ("Broken down from <KEY>").
//
// a11y: every input is labeled; per-row errors are aria-live.

import { useId, useState } from "react";
import { Plus, Trash2, Loader2, CheckCircle2, XCircle } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createPoTicket, updateTicketPoints } from "../hooks/useJira";
import { formatPoints } from "../lib/format";
import type { McpError } from "../lib/mcpClient";
import type { IssueSummary } from "../lib/types";

const MIN_ROWS = 2;
const MAX_ROWS = 6;

type RowStatus = "pending" | "creating" | "created" | "error";

interface Row {
  id: string;
  summary: string;
  points: string; // controlled input string; parsed to a number on create
  status: RowStatus;
  key?: string;
  url?: string;
  error?: string;
}

let rowSeq = 0;
const newRowId = (): string => `bd-${(++rowSeq).toString(36)}`;

function initialRows(originalSummary: string): Row[] {
  return [1, 2].map((n) => ({
    id: newRowId(),
    summary: `${originalSummary} (part ${n})`,
    points: "0",
    status: "pending" as const,
  }));
}

export interface BreakdownDialogProps {
  /** The original oversized ticket — key, summary, and current points are shown read-only. */
  issue: IssueSummary;
  /** The Draft Capacity Plan card's PO sprint — every new story is created into it. */
  sprintId: number;
  onClose: () => void;
  /**
   * Fired once, right after every row has successfully been created (the initial
   * batch or a later retry), so the card can refetch the PO sprint — the new
   * stories then appear as unplanned chips ready to draft.
   */
  onCreated: () => void;
}

export function BreakdownDialog({ issue, sprintId, onClose, onCreated }: BreakdownDialogProps) {
  const formId = useId();
  const [rows, setRows] = useState<Row[]>(() => initialRows(issue.summary));
  const [zeroOriginal, setZeroOriginal] = useState(false);
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const [zeroError, setZeroError] = useState<string | null>(null);

  // Once creation has started, rows are read-only — only a per-row Retry mutates.
  const locked = running || started;
  const allCreated = started && rows.every((r) => r.status === "created");

  function addRow() {
    setRows((prev) =>
      prev.length >= MAX_ROWS
        ? prev
        : [
            ...prev,
            {
              id: newRowId(),
              summary: `${issue.summary} (part ${prev.length + 1})`,
              points: "0",
              status: "pending",
            },
          ]
    );
  }

  function removeRow(id: string) {
    setRows((prev) => (prev.length <= MIN_ROWS ? prev : prev.filter((r) => r.id !== id)));
  }

  function editRow(id: string, patch: Partial<Pick<Row, "summary" | "points">>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function rowValid(r: Row): boolean {
    const s = r.summary.trim();
    const n = Number(r.points);
    return s.length > 0 && s.length <= 255 && Number.isFinite(n) && n >= 0;
  }
  const canCreate = !locked && rows.length >= MIN_ROWS && rows.every(rowValid);

  /** Attempt (or retry) ONE row's create_po_ticket call; returns whether it succeeded. */
  async function createRow(id: string): Promise<boolean> {
    const row = rows.find((r) => r.id === id);
    if (!row) return false;
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status: "creating", error: undefined } : r)));
    try {
      const created = await createPoTicket({
        summary: row.summary.trim(),
        description: `Broken down from ${issue.key}: ${issue.summary}`,
        storyPoints: Number(row.points),
        sprintId,
      });
      setRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status: "created", key: created.key, url: created.url } : r))
      );
      return true;
    } catch (err: unknown) {
      const msg = (err as McpError)?.message ?? "Failed to create";
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status: "error", error: msg } : r)));
      return false;
    }
  }

  /** After every row is created: optionally zero the original's points, then refetch. */
  async function finalize() {
    if (zeroOriginal) {
      try {
        await updateTicketPoints(issue.key, 0);
      } catch (err: unknown) {
        setZeroError((err as McpError)?.message ?? `Failed to set ${issue.key}'s points to 0`);
      }
    }
    onCreated();
  }

  async function handleCreate() {
    setStarted(true);
    setRunning(true);
    let allOk = true;
    // Sequential — never parallel: a stable per-row status log + no Jira write storms.
    for (const row of rows) {
      // eslint-disable-next-line no-await-in-loop
      const ok = await createRow(row.id);
      if (!ok) allOk = false;
    }
    setRunning(false);
    if (allOk) await finalize();
  }

  async function handleRetry(id: string) {
    const row = rows.find((r) => r.id === id);
    if (!row || row.status !== "error") return; // succeeded rows are LOCKED — never re-created
    setRunning(true);
    const ok = await createRow(id);
    setRunning(false);
    // Every OTHER row was already "created" (or this one just became "created") -> done.
    const allNowCreated = ok && rows.every((r) => r.id === id || r.status === "created");
    if (allNowCreated) await finalize();
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v && !locked) onClose(); }}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Break down {issue.key}</DialogTitle>
          <DialogDescription>
            <span className="font-mono font-semibold text-foreground">{issue.key}</span> — {issue.summary} —
            currently <span className="font-semibold text-foreground">{formatPoints(issue.storyPoints ?? 0)} pts</span>.
            Split it into 2-6 new PO stories in the same sprint.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {rows.map((row, idx) => (
            <div key={row.id} className="rounded-md border border-border bg-muted/20 p-2.5 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">
                  Row {idx + 1}
                </span>
                <div className="flex items-center gap-1.5">
                  {row.status === "pending" && locked && (
                    <span className="text-[0.6875rem] text-muted-foreground">queued…</span>
                  )}
                  {row.status === "creating" && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden="true" />
                  )}
                  {row.status === "created" && (
                    <a
                      href={row.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-mono font-bold text-primary hover:underline"
                      aria-label={`Open ${row.key} in Jira`}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden="true" />
                      {row.key}
                    </a>
                  )}
                  {row.status === "error" && <XCircle className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />}
                  {!locked && rows.length > MIN_ROWS && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1.5 text-destructive hover:text-destructive"
                      onClick={() => removeRow(row.id)}
                      aria-label={`Remove row ${idx + 1}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  )}
                </div>
              </div>
              <div className="flex gap-2 items-end flex-wrap">
                <div className="flex-1 min-w-[160px]">
                  <Label htmlFor={`${formId}-sum-${row.id}`} className="text-xs font-semibold mb-1 block">
                    Summary
                  </Label>
                  <Input
                    id={`${formId}-sum-${row.id}`}
                    value={row.summary}
                    maxLength={255}
                    disabled={locked}
                    onChange={(e) => editRow(row.id, { summary: e.target.value })}
                  />
                </div>
                <div className="w-24">
                  <Label htmlFor={`${formId}-pts-${row.id}`} className="text-xs font-semibold mb-1 block">
                    Points
                  </Label>
                  <Input
                    id={`${formId}-pts-${row.id}`}
                    type="number"
                    min={0}
                    step="any"
                    value={row.points}
                    disabled={locked}
                    onChange={(e) => editRow(row.id, { points: e.target.value })}
                    aria-label={`Story points for row ${idx + 1}`}
                  />
                </div>
              </div>
              {row.status === "error" && (
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-destructive" aria-live="polite">{row.error}</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-6 text-[0.6875rem] flex-shrink-0"
                    onClick={() => void handleRetry(row.id)}
                    disabled={running}
                    aria-label={`Retry row ${idx + 1}`}
                  >
                    Retry
                  </Button>
                </div>
              )}
            </div>
          ))}

          {!locked && rows.length < MAX_ROWS && (
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={addRow}>
              <Plus className="h-3.5 w-3.5 mr-1" aria-hidden="true" /> Add row
            </Button>
          )}

          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id={`${formId}-zero`}
              checked={zeroOriginal}
              disabled={locked}
              onChange={(e) => setZeroOriginal(e.target.checked)}
              className="h-4 w-4 cursor-pointer accent-[hsl(var(--primary))]"
            />
            <Label htmlFor={`${formId}-zero`} className="text-xs font-normal cursor-pointer">
              Set {issue.key}&apos;s points to 0 after creating
            </Label>
          </div>
          {zeroError && <p className="text-xs text-destructive" aria-live="polite">{zeroError}</p>}
        </div>

        <DialogFooter className="gap-2">
          {allCreated ? (
            // aria-label disambiguates from DialogContent's own built-in "Close" (X) button.
            <Button type="button" onClick={onClose} aria-label="Close breakdown dialog">Close</Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={onClose} disabled={locked}>
                Cancel
              </Button>
              <Button type="button" onClick={() => void handleCreate()} disabled={!canCreate || started}>
                {running ? "Creating…" : `Create (${rows.length})`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
