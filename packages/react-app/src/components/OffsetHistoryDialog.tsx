// OffsetHistoryDialog (v1.33, ADR-044 — Phase 2) — per-developer offset usage history.
// Shows the running standing (earned / used / manual / balance) + every Offset leave (a spend).

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { OffsetHistory } from "../lib/offsetWallet";

function shortDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

function Tile({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  const tone = strong ? (value > 0 ? "text-success" : value < 0 ? "text-destructive" : "text-foreground") : "text-foreground";
  return (
    <div className="rounded-md bg-muted px-2 py-1.5">
      <p className={cn("text-base font-bold tabular-nums leading-none", tone)}>{value}</p>
      <p className="text-[0.5625rem] uppercase tracking-wide text-muted-foreground mt-0.5">{label}</p>
    </div>
  );
}

export function OffsetHistoryDialog({
  assignee,
  history,
  open,
  onOpenChange,
}: {
  assignee: string | null;
  history: OffsetHistory | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Offset history{assignee ? ` — ${assignee}` : ""}</DialogTitle>
          <DialogDescription>
            Earned points bank per sprint; using an offset (plotting an Offset leave) spends from the balance.
          </DialogDescription>
        </DialogHeader>

        {history && (
          <div className="space-y-3">
            <div className="grid grid-cols-4 gap-2 text-center">
              <Tile label="Earned" value={history.earned} />
              <Tile label="Used" value={history.spent} />
              <Tile label="Manual" value={history.manual} />
              <Tile label="Balance" value={history.balance} strong />
            </div>

            <div>
              <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                Usage ({history.usage.length})
              </p>
              {history.usage.length === 0 ? (
                <p className="text-sm text-muted-foreground">No offsets used yet.</p>
              ) : (
                <ul className="max-h-60 overflow-y-auto" aria-label="Offset usage history">
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
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
