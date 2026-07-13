// OffsetHistoryDialog (v1.33, ADR-044; v1.54, ADR-065) — per-developer offset history + adjustments.
// Shows the standing (earned / used / opening / adjust / balance) and THREE logs: earned per sprint
// (banked), used (each Offset leave), and the manual-adjustment log — which you can add to / remove here.

import { useState, type FormEvent } from "react";
import { Plus, Trash2, Loader2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { formatPoints } from "../lib/format";
import type { OffsetHistory } from "../lib/offsetWallet";

function shortDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

/** Format an ISO timestamp (adjustment createdAt) as a short date. */
function shortTimestamp(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// v1.55 (ADR-066): decimals allowed → format the number part (≤2 dp, trailing zeros trimmed). U+2212 minus
// for negatives (matches the Used column).
function signed(n: number): string {
  return n > 0 ? `+${formatPoints(n)}` : `−${formatPoints(Math.abs(n))}`;
}

function Tile({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  const tone = strong ? (value > 0 ? "text-success" : value < 0 ? "text-destructive" : "text-foreground") : "text-foreground";
  return (
    <div className="rounded-md bg-muted px-2 py-1.5">
      <p className={cn("text-base font-bold tabular-nums leading-none", tone)}>{formatPoints(value)}</p>
      <p className="text-[0.5625rem] uppercase tracking-wide text-muted-foreground mt-0.5">{label}</p>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground mb-1">{children}</p>
  );
}

export function OffsetHistoryDialog({
  assignee,
  history,
  open,
  onOpenChange,
  onAddAdjustment,
  onDeleteAdjustment,
}: {
  assignee: string | null;
  history: OffsetHistory | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** v1.54: when provided, the manual-adjustment log gets an add form + per-entry delete. */
  onAddAdjustment?: (assignee: string, amount: number, note: string) => Promise<void>;
  onDeleteAdjustment?: (assignee: string, id: string) => Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const canEdit = !!assignee && !!onAddAdjustment;

  const parsedAmount = Number.parseFloat(amount); // v1.55 (ADR-066): decimals allowed (e.g. 0.5)
  const amountValid = Number.isFinite(parsedAmount) && parsedAmount !== 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!assignee || !onAddAdjustment || !amountValid || busy) return;
    setBusy(true);
    try {
      await onAddAdjustment(assignee, parsedAmount, note);
      setAmount("");
      setNote("");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!assignee || !onDeleteAdjustment || busy) return;
    setBusy(true);
    try {
      await onDeleteAdjustment(assignee, id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Offset history{assignee ? ` — ${assignee}` : ""}</DialogTitle>
          <DialogDescription>
            Earned banks per sprint; using an offset spends from the balance; manual adjustments (± with a
            note) are for anything else.
          </DialogDescription>
        </DialogHeader>

        {history && (
          <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-5 gap-2 text-center">
              <Tile label="Earned" value={history.earned} />
              <Tile label="Used" value={history.spent} />
              <Tile label="Opening" value={history.manual} />
              <Tile label="Adjust" value={history.adjustmentsTotal} />
              <Tile label="Balance" value={history.balance} strong />
            </div>

            {/* Earned per sprint (banked) — v1.54 */}
            <div>
              <SectionLabel>Earned ({history.earnedBySprint.length})</SectionLabel>
              {history.earnedBySprint.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing banked yet.</p>
              ) : (
                <ul className="max-h-40 overflow-y-auto" aria-label="Offset earned history">
                  {history.earnedBySprint.map((e) => (
                    <li key={e.sprintId} className="flex items-center gap-2 text-sm border-b border-border/40 py-1.5">
                      <span className="flex-1 min-w-0 text-foreground truncate" title={e.sprintName ?? `Sprint ${e.sprintId}`}>
                        {e.sprintName ?? `Sprint ${e.sprintId}`}
                      </span>
                      <span className="text-success font-semibold flex-shrink-0 tabular-nums">+{formatPoints(e.earned)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Used (offset leaves) */}
            <div>
              <SectionLabel>Used ({history.usage.length})</SectionLabel>
              {history.usage.length === 0 ? (
                <p className="text-sm text-muted-foreground">No offsets used yet.</p>
              ) : (
                <ul className="max-h-40 overflow-y-auto" aria-label="Offset usage history">
                  {history.usage.map((u) => (
                    <li key={`${u.sprintId}-${u.date}`} className="flex items-center gap-2 text-sm border-b border-border/40 py-1.5">
                      <span className="text-foreground flex-shrink-0">{shortDate(u.date)}</span>
                      <span className="flex-1 min-w-0 text-[0.6875rem] text-muted-foreground truncate text-right" title={u.sprintName ?? `Sprint ${u.sprintId}`}>
                        {u.sprintName ?? `Sprint ${u.sprintId}`}
                      </span>
                      <span className="text-destructive font-semibold flex-shrink-0 tabular-nums">−1</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Manual adjustments log — v1.54 (add / remove here) */}
            <div>
              <SectionLabel>Manual adjustments ({history.adjustments.length})</SectionLabel>
              {history.adjustments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No manual adjustments.</p>
              ) : (
                <ul className="max-h-40 overflow-y-auto" aria-label="Manual adjustments">
                  {history.adjustments.map((a) => (
                    <li key={a.id} className="flex items-center gap-2 text-sm border-b border-border/40 py-1.5">
                      <span className="text-muted-foreground flex-shrink-0 text-[0.6875rem]">{shortTimestamp(a.createdAt)}</span>
                      <span className="flex-1 min-w-0 text-foreground truncate" title={a.note}>{a.note || <span className="text-muted-foreground italic">no note</span>}</span>
                      <span className={cn("font-semibold flex-shrink-0 tabular-nums", a.amount > 0 ? "text-success" : "text-destructive")}>
                        {signed(a.amount)}
                      </span>
                      {canEdit && onDeleteAdjustment && (
                        <Button
                          type="button" size="sm" variant="ghost" className="h-6 w-6 p-0 flex-shrink-0"
                          disabled={busy} onClick={() => void remove(a.id)}
                          aria-label={`Remove adjustment ${signed(a.amount)}${a.note ? ` (${a.note})` : ""}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {canEdit && (
                <form onSubmit={submit} className="flex flex-wrap items-end gap-2 mt-2 border-t border-border pt-2">
                  <div className="w-20">
                    <Label htmlFor="adj-amount" className="text-xs font-medium">Amount ±</Label>
                    <Input
                      id="adj-amount" type="number" step="0.5" inputMode="decimal" placeholder="±"
                      value={amount} onChange={(e) => setAmount(e.target.value)} className="h-8"
                    />
                  </div>
                  <div className="flex-1 min-w-[140px]">
                    <Label htmlFor="adj-note" className="text-xs font-medium">Note (optional)</Label>
                    <Input
                      id="adj-note" maxLength={200} placeholder="e.g. comp for weekend on-call"
                      value={note} onChange={(e) => setNote(e.target.value)} className="h-8"
                    />
                  </div>
                  <Button type="submit" size="sm" disabled={!amountValid || busy}>
                    {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" aria-hidden="true" />
                      : <Plus className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />}
                    Add
                  </Button>
                </form>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
