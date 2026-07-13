// OffsetWalletCard (v1.33, ADR-044) — the main offset tracker: each developer's running balance.
// Balance auto-updates: earned banks per sprint (ledger); used auto-deducts from plotting Offset
// leaves (derived). Per-row History button (wired in Phase 2) when onHistory is provided.

import { Wallet } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { OffsetWalletEntry } from "../lib/offsetWallet";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const EMPTY: OffsetWalletEntry = { earned: 0, spent: 0, manual: 0, adjustmentsTotal: 0, balance: 0 };

export function OffsetWalletCard({
  wallet,
  roster,
  onHistory,
}: {
  wallet: Record<string, OffsetWalletEntry>;
  roster: string[];
  /** When provided, each row shows a History button (Phase 2). */
  onHistory?: (assignee: string) => void;
}) {
  const names = Array.from(new Set([...roster, ...Object.keys(wallet)])).sort((a, b) => a.localeCompare(b));

  return (
    <Card className="shadow-sm">
      <CardHeader className="px-4 pt-3 pb-2">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          <Wallet className="h-4 w-4 text-primary" aria-hidden="true" />
          Offset balances
          <span className="text-xs font-normal text-muted-foreground">(earned − used + opening)</span>
        </h3>
      </CardHeader>
      <CardContent className="px-4 pb-3 pt-0">
        {names.length === 0 ? (
          <p className="text-sm text-muted-foreground">No developers yet — add them in Planning → Manage team.</p>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2" aria-label="Offset balances">
            {names.map((name) => {
              const w = wallet[name] ?? EMPTY;
              const tone = w.balance > 0 ? "text-success" : w.balance < 0 ? "text-destructive" : "text-muted-foreground";
              return (
                <li key={name} className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2">
                  <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-primary/10 text-primary font-semibold text-[0.625rem] flex-shrink-0" aria-hidden="true">
                    {initials(name)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate" title={name}>{name}</p>
                    <p className="text-[0.6875rem] text-muted-foreground">
                      earned {w.earned} · used {w.spent}
                      {w.manual !== 0 ? ` · opening ${w.manual > 0 ? "+" : ""}${w.manual}` : ""}
                      {w.adjustmentsTotal !== 0 ? ` · adj ${w.adjustmentsTotal > 0 ? "+" : ""}${w.adjustmentsTotal}` : ""}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={cn("text-lg font-bold tabular-nums leading-none", tone)}>{w.balance}</p>
                    <p className="text-[0.5625rem] uppercase tracking-wide text-muted-foreground">balance</p>
                  </div>
                  {onHistory && (
                    <Button
                      type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs flex-shrink-0"
                      onClick={() => onHistory(name)}
                      aria-label={`Offset history for ${name}`}
                    >
                      History
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
