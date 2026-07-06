// ConfirmActionDialog — modal confirmation for an assistant-proposed write (v1.19, ADR-030).
// The AI never executes writes; it proposes them. This dialog confirms + executes the write.

import { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { callTool, type McpError } from "../lib/mcpClient";
import type { ProposedAction } from "../lib/types";

const ACTION_TITLES: Record<string, string> = {
  update_ticket: "Update ticket",
  transition_issue: "Change status",
  move_issue_to_sprint: "Move ticket to sprint",
  create_sprint: "Create sprint",
  set_sprint_goal: "Set sprint goal",
  assign_issue: "Assign ticket",
  set_leaves: "File leaves", // v1.40 (ADR-050)
};

const str = (v: unknown): string => (v == null ? "" : String(v));

// v1.40: arrays/objects (e.g. set_leaves entries) render as JSON, not "[object Object]".
const pretty = (v: unknown): string =>
  v !== null && typeof v === "object" ? JSON.stringify(v) : str(v);

interface ConfirmActionDialogProps {
  action: ProposedAction | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with a chat message after a successful execution. */
  onResult: (message: string) => void;
}

export function ConfirmActionDialog({ action, open, onOpenChange, onResult }: ConfirmActionDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Editable args (used by the create_sprint form; passthrough otherwise).
  const [formArgs, setFormArgs] = useState<Record<string, unknown>>({});

  useEffect(() => {
    setFormArgs(action?.args ?? {});
    setError(null);
  }, [action]);

  if (!action) return null;
  const isCreateSprint = action.tool === "create_sprint";
  const title = ACTION_TITLES[action.tool] ?? action.tool;

  async function confirm() {
    if (!action) return;
    setBusy(true);
    setError(null);
    const args = isCreateSprint ? formArgs : action.args;
    try {
      const result = await callTool<{ key?: string; name?: string }>("jira", action.tool, args);
      const suffix = result?.key ? ` (${result.key})` : result?.name ? ` (${result.name})` : "";
      onResult(`✓ ${title} done${suffix}.`);
      onOpenChange(false);
    } catch (err) {
      setError((err as McpError)?.message ?? "Action failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}?</DialogTitle>
          <DialogDescription>
            The assistant proposed this change. Review and confirm — nothing runs until you do.
          </DialogDescription>
        </DialogHeader>

        {isCreateSprint ? (
          <div className="space-y-3">
            <div>
              <Label htmlFor="cs-name" className="text-xs font-semibold">Sprint name</Label>
              <Input id="cs-name" value={str(formArgs["name"])}
                onChange={(e) => setFormArgs((a) => ({ ...a, name: e.target.value }))} />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <Label htmlFor="cs-start" className="text-xs font-semibold">Start (YYYY-MM-DD)</Label>
                <Input id="cs-start" value={str(formArgs["startDate"])}
                  onChange={(e) => setFormArgs((a) => ({ ...a, startDate: e.target.value || undefined }))} />
              </div>
              <div className="flex-1">
                <Label htmlFor="cs-end" className="text-xs font-semibold">End (YYYY-MM-DD)</Label>
                <Input id="cs-end" value={str(formArgs["endDate"])}
                  onChange={(e) => setFormArgs((a) => ({ ...a, endDate: e.target.value || undefined }))} />
              </div>
            </div>
            <div>
              <Label htmlFor="cs-goal" className="text-xs font-semibold">Goal (optional)</Label>
              <Textarea id="cs-goal" rows={2} value={str(formArgs["goal"])}
                onChange={(e) => setFormArgs((a) => ({ ...a, goal: e.target.value || undefined }))} />
            </div>
          </div>
        ) : (
          <ul className="text-sm space-y-1" aria-label="Proposed change details">
            {Object.entries(action.args).map(([k, v]) => (
              <li key={k}>
                <span className="text-muted-foreground">{k}:</span>{" "}
                <span className="font-medium break-words">{pretty(v)}</span>
              </li>
            ))}
          </ul>
        )}

        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void confirm()} disabled={busy}>
            {busy ? "Working…" : "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
