// RefineDraftControl — comment box + "Regenerate" for an AI draft (v1.12, ADR-023)
//
// Shared by the Linking plan (per item) and TicketGen (the draft pair). The caller
// owns the AI call; this component just collects a comment and fires onRegenerate.
// Rendered only when AI is enabled (a comment can't steer a deterministic template).

import { useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

export interface RefineDraftControlProps {
  /** Called with the trimmed comment when the user clicks Regenerate. */
  onRegenerate: (comment: string) => void;
  /** True while this draft is regenerating — disables input + spins the button. */
  busy: boolean;
  /** a11y label suffix, e.g. the PO key — keeps multiple controls distinguishable. */
  labelFor?: string;
  /** Optional placeholder override. */
  placeholder?: string;
}

export function RefineDraftControl({
  onRegenerate,
  busy,
  labelFor,
  placeholder,
}: RefineDraftControlProps) {
  const [comment, setComment] = useState("");
  const trimmed = comment.trim();

  function handle() {
    if (trimmed === "" || busy) return;
    onRegenerate(trimmed);
    setComment("");
  }

  const aria = labelFor
    ? `Comment to refine the draft for ${labelFor}`
    : "Comment to refine the draft";

  return (
    <div className="rounded-md border border-dashed border-border bg-muted/20 p-2 space-y-2">
      <Label htmlFor={`refine-${labelFor ?? "draft"}`} className="sr-only">
        {aria}
      </Label>
      <Textarea
        id={`refine-${labelFor ?? "draft"}`}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            handle();
          }
        }}
        rows={2}
        disabled={busy}
        aria-label={aria}
        placeholder={placeholder ?? "Add a comment to refine this draft, then regenerate…"}
        className="text-sm min-h-[44px]"
      />
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handle}
          disabled={busy || trimmed === ""}
          className="h-7 text-xs"
        >
          {busy ? (
            <Loader2 className="h-3 w-3 mr-1 animate-spin" aria-hidden="true" />
          ) : (
            <Sparkles className="h-3 w-3 mr-1" aria-hidden="true" />
          )}
          {busy ? "Regenerating…" : "Regenerate"}
        </Button>
        <span className="text-[0.6875rem] text-muted-foreground">⌘/Ctrl+Enter</span>
      </div>
    </div>
  );
}
