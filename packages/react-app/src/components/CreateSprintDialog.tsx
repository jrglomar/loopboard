// CreateSprintDialog — v1.4 (CONTRACTS.md §6, ADR-011)
// Opens a dialog for creating a new future sprint on the Jira board.
// Owned by Dashboard; on success, calls onSuccess(newSprintId) so Dashboard
// can refetch the board and select the new sprint.

import { useState, useId } from "react";
import { PlusCircle } from "lucide-react";
import { createSprint } from "../hooks/useJira";
import { type McpError } from "../lib/mcpClient";
import { type SprintRef } from "../lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// ── Props ─────────────────────────────────────────────────────────────────────

export interface CreateSprintDialogProps {
  /** Called with the new sprint id after a successful create */
  onSuccess: (newSprint: SprintRef) => void;
  /**
   * v1.6 (ADR-017): optional board id — when provided, creates the sprint on that
   * board (passes boardId to create_sprint). Defaults to server-side Dev board.
   */
  boardId?: number;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CreateSprintDialog({ onSuccess, boardId }: CreateSprintDialogProps) {
  const formId = useId();

  const [open, setOpen] = useState(false);

  // Form fields
  const [name, setName]           = useState("");
  const [goal, setGoal]           = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate]     = useState("");

  // State
  const [submitting, setSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<McpError | null>(null);

  // ── Validation ────────────────────────────────────────────────────────────

  function validate(): string | null {
    if (!name.trim()) return "Sprint name is required.";
    if (startDate && endDate && startDate >= endDate) {
      return "Start date must be before end date.";
    }
    return null;
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleOpen = () => {
    // Reset state when opening fresh
    setName("");
    setGoal("");
    setStartDate("");
    setEndDate("");
    setFieldError(null);
    setServerError(null);
    setOpen(true);
  };

  const handleClose = () => {
    if (!submitting) setOpen(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validate();
    if (err) {
      setFieldError(err);
      return;
    }
    setFieldError(null);
    setServerError(null);
    setSubmitting(true);

    try {
      const body: Parameters<typeof createSprint>[0] = { name: name.trim() };
      if (goal.trim())           body.goal      = goal.trim();
      if (startDate)             body.startDate = startDate;
      if (endDate)               body.endDate   = endDate;
      // v1.6 (ADR-017): scope creation to the selected board when provided
      if (boardId !== undefined) body.boardId   = boardId;

      const newSprint = await createSprint(body);
      setOpen(false);
      onSuccess(newSprint);
    } catch (err: unknown) {
      setServerError(err as McpError);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Trigger button */}
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={handleOpen}
        className="h-9 text-xs gap-1.5"
        aria-label="Create new sprint"
      >
        <PlusCircle className="h-3.5 w-3.5" aria-hidden="true" />
        New Sprint
      </Button>

      {/* a11y: shadcn Dialog handles focus trap and Esc-to-close automatically */}
      <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Sprint</DialogTitle>
            {/* a11y: DialogDescription satisfies WAI-ARIA labeling requirement */}
            <DialogDescription>
              This will create a <strong>real future sprint</strong> on your Jira board.
              You can start it in Jira when your team is ready.
            </DialogDescription>
          </DialogHeader>

          <form
            id={`${formId}-form`}
            onSubmit={(e) => void handleSubmit(e)}
            className="space-y-4"
            noValidate
          >
            {/* Sprint name — required */}
            <div className="space-y-1.5">
              <Label htmlFor={`${formId}-name`} className="text-sm font-semibold">
                Sprint name{" "}
                <span className="text-destructive" aria-hidden="true">*</span>
              </Label>
              <Input
                id={`${formId}-name`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Sprint 8"
                maxLength={255}
                aria-required="true"
                aria-describedby={fieldError ? `${formId}-field-err` : undefined}
                className={cn(fieldError && !name.trim() && "border-destructive focus-visible:ring-destructive")}
                autoFocus
              />
            </div>

            {/* Goal — optional textarea */}
            <div className="space-y-1.5">
              <Label htmlFor={`${formId}-goal`} className="text-sm font-semibold">
                Sprint goal <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Textarea
                id={`${formId}-goal`}
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="What should the team accomplish?"
                rows={2}
              />
            </div>

            {/* Date range */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor={`${formId}-start`} className="text-sm font-semibold">
                  Start date <span className="text-muted-foreground font-normal">(opt.)</span>
                </Label>
                {/* a11y: native date input for keyboard + mobile compatibility; ADR-009 */}
                <Input
                  id={`${formId}-start`}
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className={cn(fieldError && startDate >= endDate && endDate && "border-destructive")}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${formId}-end`} className="text-sm font-semibold">
                  End date <span className="text-muted-foreground font-normal">(opt.)</span>
                </Label>
                <Input
                  id={`${formId}-end`}
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className={cn(fieldError && startDate >= endDate && endDate && "border-destructive")}
                />
              </div>
            </div>

            {/* Inline validation error */}
            {fieldError && (
              <p
                id={`${formId}-field-err`}
                className="text-xs text-destructive flex items-center gap-1"
                role="alert"
              >
                {fieldError}
              </p>
            )}

            {/* Server / upstream error */}
            {serverError && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>
                  <span className="font-bold">[{serverError.code}]</span>{" "}
                  {serverError.message}
                </AlertDescription>
              </Alert>
            )}
          </form>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form={`${formId}-form`}
              disabled={submitting}
            >
              {submitting ? "Creating…" : "Create Sprint"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
