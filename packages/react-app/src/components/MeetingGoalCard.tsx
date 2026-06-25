// MeetingGoalCard — Huddle "goal for today's meeting" (v1.20, ADR-031).
// The standup's focus, distinct from the Jira sprint goal. Inline-editable; backed by useMeetingGoal.

import { useState, useEffect } from "react";
import { Megaphone, Pencil, Check, X } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useMeetingGoal } from "../hooks/useJira";

export function MeetingGoalCard({ sprintId }: { sprintId: number | null }) {
  const { data, loading, error, save } = useMeetingGoal(sprintId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const goal = data?.goal ?? "";

  // Seed the draft from the loaded goal whenever we enter edit mode / data changes.
  useEffect(() => {
    if (!editing) setDraft(goal);
  }, [goal, editing]);

  async function commit() {
    if (sprintId === null) return;
    setBusy(true);
    try {
      await save(draft.trim());
      setEditing(false);
    } catch { /* hook reverts */ } finally { setBusy(false); }
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="px-3 pt-3 pb-1.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <Megaphone className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            Meeting goal
          </h3>
          {sprintId !== null && !editing && (
            <button
              type="button"
              onClick={() => { setDraft(goal); setEditing(true); }}
              className="text-muted-foreground hover:text-foreground focus:outline-none focus:ring-1 focus:ring-ring rounded"
              aria-label="Edit meeting goal"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-3 pb-3 space-y-2">
        {sprintId === null ? (
          <p className="text-sm text-muted-foreground">Select a sprint to set today's focus.</p>
        ) : editing ? (
          <>
            <label htmlFor="mg-goal" className="sr-only">Meeting goal</label>
            <Textarea
              id="mg-goal"
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="What's the focus for today's standup?"
              aria-label="Meeting goal"
            />
            <div className="flex items-center gap-1.5">
              <Button type="button" size="sm" className="h-8" onClick={() => void commit()} disabled={busy}>
                <Check className="h-4 w-4 mr-1" aria-hidden="true" /> Save
              </Button>
              <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => setEditing(false)} disabled={busy}>
                <X className="h-4 w-4 mr-1" aria-hidden="true" /> Cancel
              </Button>
            </div>
          </>
        ) : (
          <>
            {loading && !data ? (
              <p className="text-xs text-muted-foreground">Loading…</p>
            ) : goal ? (
              <p className="text-sm text-foreground whitespace-pre-wrap">{goal}</p>
            ) : (
              <p className="text-sm text-muted-foreground italic">No goal — set the focus for today's standup.</p>
            )}
          </>
        )}
        {error && <p className="text-xs text-destructive" role="alert">{error.message}</p>}
      </CardContent>
    </Card>
  );
}
