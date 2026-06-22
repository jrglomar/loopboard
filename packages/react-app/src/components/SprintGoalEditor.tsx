// SprintGoalEditor — inline edit of a sprint's goal (v1.13, ADR-024)
//
// Read view: Goal + "Edit". Edit view: textarea + Save/Cancel → set_sprint_goal.
// Used in the Planning context header so the Scrum Master keeps the goal current.

import { useState, useEffect } from "react";
import { Target, Pencil, Check, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { setSprintGoal } from "../hooks/useJira";
import type { McpError } from "../lib/mcpClient";

export interface SprintGoalEditorProps {
  sprintId: number;
  goal: string | null;
  /** Called after a successful save (e.g. to refetch the sprint list). */
  onSaved?: (goal: string | null) => void;
}

export function SprintGoalEditor({ sprintId, goal, onSaved }: SprintGoalEditorProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(goal ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset when the sprint or its goal changes from outside.
  useEffect(() => {
    setDraft(goal ?? "");
    setEditing(false);
    setError(null);
  }, [sprintId, goal]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await setSprintGoal(sprintId, draft.trim());
      onSaved?.(res.goal);
      setEditing(false);
    } catch (e) {
      setError((e as McpError).message ?? "Failed to save goal");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex items-start gap-2 rounded-md bg-muted/40 border border-border px-3 py-2">
        <Target className="h-3.5 w-3.5 text-primary mt-0.5 flex-shrink-0" aria-hidden="true" />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-0.5 whitespace-nowrap">
          Goal
        </span>
        {goal ? (
          <p className="text-sm text-foreground leading-relaxed flex-1 min-w-0">{goal}</p>
        ) : (
          <p className="text-sm text-muted-foreground italic flex-1 min-w-0">No goal set.</p>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 text-xs flex-shrink-0"
          onClick={() => setEditing(true)}
          aria-label="Edit sprint goal"
        >
          <Pencil className="h-3 w-3 mr-1" aria-hidden="true" />
          Edit
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-md bg-muted/40 border border-border px-3 py-2 space-y-2">
      <label
        htmlFor={`sprint-goal-edit-${sprintId}`}
        className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block"
      >
        Sprint goal
      </label>
      <Textarea
        id={`sprint-goal-edit-${sprintId}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={2}
        placeholder="What is this sprint trying to achieve?"
        aria-label="Sprint goal"
        disabled={saving}
      />
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="button" size="sm" className="h-7 text-xs" onClick={() => void save()} disabled={saving}>
          {saving ? (
            <Loader2 className="h-3 w-3 mr-1 animate-spin" aria-hidden="true" />
          ) : (
            <Check className="h-3 w-3 mr-1" aria-hidden="true" />
          )}
          Save
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => { setEditing(false); setDraft(goal ?? ""); setError(null); }}
          disabled={saving}
        >
          <X className="h-3 w-3 mr-1" aria-hidden="true" />
          Cancel
        </Button>
      </div>
    </div>
  );
}
