// BankOffsetsDialog (v1.50, ADR-061) — confirm banking a sprint's computed offset earnings into
// the wallet. Replaces the old auto-bank-on-view: the user reviews each developer's earned offset
// for the sprint and confirms before anything is written.

import { useState } from "react";
import { Wallet, ArrowRight } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** One developer's earned offset for the sprint, and what's currently banked (null = not yet). */
export interface BankRow {
  name: string;
  earned: number; // computed earned this sprint (0 or 1)
  banked: number | null; // already-banked earned for this sprint, or null if never banked
}

export function BankOffsetsDialog({
  open, onOpenChange, sprintName, rows, onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sprintName: string;
  rows: BankRow[];
  /** Bank the sprint (writes each row's earned). Resolves when done. */
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const earners = rows.filter((r) => r.earned > 0);
  // A row "changes" if its computed earned differs from what's banked (null counts as a change when earned>0).
  const changes = rows.filter((r) => r.earned !== (r.banked ?? 0));
  const nothingToDo = changes.length === 0;

  async function confirm() {
    setBusy(true); setError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not bank offsets");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-primary" aria-hidden="true" /> Bank offsets — {sprintName}
          </DialogTitle>
          <DialogDescription>
            This adds each developer's earned offset for <span className="font-medium text-foreground">{sprintName}</span> to
            their balance. Re-banking the same sprint replaces its earlier value — it never double-counts.
          </DialogDescription>
        </DialogHeader>

        {earners.length === 0 ? (
          <p className="text-sm text-muted-foreground">No developer earned an offset this sprint — nothing to bank.</p>
        ) : (
          <ul className="text-sm divide-y divide-border border border-border rounded-md" aria-label="Offsets to bank">
            {earners.map((r) => {
              const changed = r.earned !== (r.banked ?? 0);
              return (
                <li key={r.name} className="flex items-center gap-2 px-3 py-1.5">
                  <span className="flex-1 font-medium text-foreground truncate">{r.name}</span>
                  {r.banked !== null && (
                    <span className="text-xs text-muted-foreground tabular-nums">banked {r.banked}</span>
                  )}
                  {r.banked !== null && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />}
                  <span className={cn("tabular-nums font-semibold", changed ? "text-success" : "text-muted-foreground")}>
                    +{r.earned}
                  </span>
                  {!changed && <span className="text-[0.6875rem] text-muted-foreground">(already banked)</span>}
                </li>
              );
            })}
          </ul>
        )}

        {nothingToDo && earners.length > 0 && (
          <p className="text-xs text-muted-foreground">Everything here is already banked — confirming changes nothing.</p>
        )}
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void confirm()} disabled={busy || nothingToDo}>
            {busy ? "Banking…" : "Bank offsets"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
