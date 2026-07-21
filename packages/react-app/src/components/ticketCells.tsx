// ticketCells — shared inline ticket-action cells (v1.69, ADR-080)
//
// PointsCell / StatusCell / MoveSprintCell moved VERBATIM out of AssignmentList.tsx
// (the Assign Tickets table) so the Draft Capacity Plan card's chips (DraftPlanCard.tsx)
// can reuse the exact same implementation instead of duplicating it — the repo's
// tool-registry rule ("one implementation consumed by every surface") applied to UI
// cells. New in v1.69: SummaryCell (inline rename) + PointsCell's optional `onSaved`.
//
// a11y: every control has an aria-label including the ticket key; mutation errors are
// aria-live. perf: no memoisation beyond what each cell already owned.

import React, { useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { updateTicketPoints, updateTicketSummary } from "../hooks/useJira";
import {
  getTransitions,
  transitionIssue,
  moveIssueToSprint,
  type IssueTransition,
} from "../lib/ticketActionsClient";
import type { IssueSummary, SprintRef } from "../lib/types";
import type { McpError } from "../lib/mcpClient";

export const cellSelectCls =
  "h-8 text-xs px-2 border border-border rounded-md bg-background text-foreground font-[inherit] cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 transition-colors hover:border-ring disabled:opacity-50 disabled:cursor-wait";

// ── Status cell (v1.15, ADR-026) — lazy-loads transitions, applies one ─────────

export function StatusCell({ issue, onChanged }: { issue: IssueSummary; onChanged: () => void }) {
  const [status, setStatus] = useState(issue.status);
  const [expanded, setExpanded] = useState(false);
  const [transitions, setTransitions] = useState<IssueTransition[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep the displayed status in sync if the sprint data refreshes.
  React.useEffect(() => { setStatus(issue.status); }, [issue.status]);

  async function openMenu() {
    setExpanded(true);
    if (transitions === null && !loading) {
      setLoading(true);
      setError(null);
      try {
        const res = await getTransitions(issue.key);
        setTransitions(res.transitions);
      } catch (err: unknown) {
        setError((err as McpError)?.message ?? "Failed to load transitions");
      } finally {
        setLoading(false);
      }
    }
  }

  async function apply(transitionId: string) {
    setApplying(true);
    setError(null);
    try {
      const res = await transitionIssue(issue.key, transitionId);
      setStatus(res.status);
      setExpanded(false);
      setTransitions(null); // invalidate — valid transitions change with the new status
      onChanged();
    } catch (err: unknown) {
      setError((err as McpError)?.message ?? "Transition failed");
    } finally {
      setApplying(false);
    }
  }

  if (!expanded) {
    return (
      <div className="flex items-center gap-1.5">
        <Badge variant="outline" className="text-[0.625rem] font-medium whitespace-nowrap">{status}</Badge>
        <button
          type="button"
          onClick={() => void openMenu()}
          className="text-[0.625rem] text-primary hover:underline focus:outline-none focus:ring-1 focus:ring-ring rounded"
          aria-label={`Change status for ${issue.key}`}
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <select
          aria-label={`New status for ${issue.key}`}
          className={cellSelectCls + " max-w-[150px]"}
          defaultValue=""
          disabled={loading || applying}
          onChange={(e) => { if (e.target.value) void apply(e.target.value); }}
        >
          <option value="">{loading ? "Loading…" : "Select status…"}</option>
          {(transitions ?? []).map((t) => (
            <option key={t.id} value={t.id}>{t.to.name}</option>
          ))}
        </select>
        {applying && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground flex-shrink-0" aria-hidden="true" />}
        {!applying && (
          <button type="button" onClick={() => setExpanded(false)}
            className="text-[0.625rem] text-muted-foreground hover:underline" aria-label="Cancel status change">
            Cancel
          </button>
        )}
      </div>
      {error && <p className="text-[0.6875rem] text-destructive" aria-live="polite">{error}</p>}
    </div>
  );
}

// ── Move-to-sprint cell (v1.15, ADR-026) ───────────────────────────────────────

export function MoveSprintCell({ issue, sprints, onMoved }: { issue: IssueSummary; sprints: SprintRef[]; onMoved: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function move(sprintId: number) {
    setSaving(true);
    setError(null);
    try {
      await moveIssueToSprint(issue.key, sprintId);
      onMoved(); // refetch — the moved ticket leaves this sprint and drops off the list
    } catch (err: unknown) {
      setError((err as McpError)?.message ?? "Move failed");
      setSaving(false);
    }
  }

  if (sprints.length === 0) {
    return <span className="text-[0.6875rem] text-muted-foreground">—</span>;
  }

  return (
    <div className="flex flex-col gap-1">
      <select
        aria-label={`Move ${issue.key} to a sprint`}
        className={cellSelectCls + " max-w-[150px]"}
        value=""
        disabled={saving}
        onChange={(e) => { if (e.target.value) void move(parseInt(e.target.value, 10)); }}
      >
        <option value="">{saving ? "Moving…" : "Move to…"}</option>
        {sprints.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
      {error && <p className="text-[0.6875rem] text-destructive" aria-live="polite">{error}</p>}
    </div>
  );
}

// ── Points cell (v1.37, ADR-047) — inline-editable story points ────────────────

export function PointsCell({ issue, onSaved }: { issue: IssueSummary; onSaved?: () => void }) {
  const initial = issue.storyPoints != null ? String(issue.storyPoints) : "";
  const [value, setValue] = useState(initial);
  const committed = React.useRef(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-sync when the underlying issue's points change (e.g. a sprint refetch).
  React.useEffect(() => {
    const v = issue.storyPoints != null ? String(issue.storyPoints) : "";
    setValue(v);
    committed.current = v;
  }, [issue.storyPoints]);

  async function commit() {
    const next = value.trim();
    if (next === committed.current) return; // unchanged — no write
    const num = Number(next);
    if (next === "" || !Number.isFinite(num) || num < 0) {
      setValue(committed.current); // invalid → revert, never write a bad value
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await updateTicketPoints(issue.key, num);
      committed.current = next;
      setSaving(false);
      setSaved(true);
      onSaved?.(); // v1.69 (ADR-080): let the caller refetch (fixes stale filtered-points summaries)
      setTimeout(() => setSaved(false), 2000);
    } catch (err: unknown) {
      setError((err as McpError)?.message ?? "Update failed");
      setValue(committed.current); // revert on failure
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <div className="flex items-center justify-end gap-1">
        <input
          type="number"
          min={0}
          step="any"
          aria-label={`Story points for ${issue.key}`}
          value={value}
          disabled={saving}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
          }}
          // guard: scrolling the page over a number input must not change its value
          onWheel={(e) => (e.target as HTMLInputElement).blur()}
          className="w-14 h-8 text-xs px-1.5 text-right border border-border rounded-md bg-background text-foreground font-[inherit] focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 transition-colors hover:border-ring disabled:opacity-50 disabled:cursor-wait"
        />
        {saving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground flex-shrink-0" aria-hidden="true" />}
        {!saving && saved && <span className="text-[0.625rem] text-[hsl(var(--status-done-text))]" aria-hidden="true">✓</span>}
      </div>
      {error && <p className="text-[0.625rem] text-destructive max-w-[120px]" aria-live="polite">{error}</p>}
    </div>
  );
}

// ── Summary cell (v1.69, ADR-080) — inline rename ───────────────────────────────

export function SummaryCell({ issue, onSaved }: { issue: IssueSummary; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(issue.summary);
  const committed = React.useRef(issue.summary);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-sync the known-committed summary when the underlying issue changes (e.g. a
  // sprint refetch); only overwrite the visible draft when the user isn't mid-edit.
  React.useEffect(() => {
    committed.current = issue.summary;
    setValue((v) => (editing ? v : issue.summary));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issue.summary]);

  function openEditor() {
    setValue(committed.current);
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setValue(committed.current);
    setError(null);
    setEditing(false);
  }

  async function commit() {
    const next = value.trim();
    if (next === "") {
      // reject empty/whitespace-only — silently revert, never write
      setValue(committed.current);
      setEditing(false);
      return;
    }
    if (next === committed.current) {
      setEditing(false); // unchanged — no write
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateTicketSummary(issue.key, next);
      committed.current = next;
      setSaving(false);
      setEditing(false);
      onSaved();
    } catch (err: unknown) {
      setError((err as McpError)?.message ?? "Rename failed");
      setValue(committed.current); // revert on failure
      setSaving(false);
    }
  }

  if (!editing) {
    // v1.69: show the locally-known-committed value (not the `issue` prop directly) so a
    // successful rename is visible immediately, without waiting for the caller's refetch
    // to flow a fresh `issue.summary` back down (same "local truth" pattern as PointsCell).
    return (
      <div className="flex items-center gap-1.5 min-w-0">
        <p className="text-sm text-foreground truncate flex-1 min-w-0" title={committed.current}>
          {committed.current}
        </p>
        <button
          type="button"
          onClick={openEditor}
          className="text-[0.625rem] text-primary hover:underline focus:outline-none focus:ring-1 focus:ring-ring rounded flex-shrink-0"
          aria-label={`Rename ${issue.key}`}
        >
          Rename
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          maxLength={255}
          aria-label={`New summary for ${issue.key}`}
          value={value}
          disabled={saving}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); void commit(); }
            else if (e.key === "Escape") { e.preventDefault(); cancel(); }
          }}
          className="h-8 text-xs px-2 flex-1 min-w-0 border border-border rounded-md bg-background text-foreground font-[inherit] focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 transition-colors hover:border-ring disabled:opacity-50 disabled:cursor-wait"
        />
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground flex-shrink-0" aria-hidden="true" />}
        <button
          type="button"
          onClick={() => void commit()}
          disabled={saving}
          className="text-[0.625rem] text-primary hover:underline focus:outline-none focus:ring-1 focus:ring-ring rounded flex-shrink-0 disabled:opacity-50"
          aria-label={`Save summary for ${issue.key}`}
        >
          Save
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={saving}
          className="text-[0.625rem] text-muted-foreground hover:underline focus:outline-none focus:ring-1 focus:ring-ring rounded flex-shrink-0 disabled:opacity-50"
          aria-label={`Cancel rename for ${issue.key}`}
        >
          Cancel
        </button>
      </div>
      {error && <p className="text-[0.6875rem] text-destructive" aria-live="polite">{error}</p>}
    </div>
  );
}
