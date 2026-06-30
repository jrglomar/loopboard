// PrBadge (v1.27, ADR-039) — compact, clickable "has linked PR" badge.
// Reused on the Huddle board (IssueCard) and Reports issue rows. Renders nothing
// when the ticket has no linked PRs. Links to the newest PR; tooltip lists all.

import { GitPullRequest } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LinkedPr } from "../lib/types";
import { summarizePrBadge, type PrTone } from "../lib/prBadge";

const TONE_CLASS: Record<PrTone, string> = {
  approved: "bg-success-bg text-success border-success-border",
  changes: "bg-[hsl(var(--error-bg))] text-destructive border-destructive/40",
  review: "bg-warning-bg text-warning-foreground border-warning-border",
  done: "bg-muted text-muted-foreground border-border",
};

/** Short repo label from "owner/repo" (or full string if no slash). */
function repoShort(repo: string): string {
  return repo.includes("/") ? repo.split("/").pop()! : repo;
}

export function PrBadge({ prs, className }: { prs: LinkedPr[] | undefined; className?: string }) {
  const info = summarizePrBadge(prs);
  if (!info) return null;
  const { count, newest, tone, openCount } = info;
  const list = prs ?? [];

  const title =
    count === 1
      ? `Linked PR — ${newest.repo ? repoShort(newest.repo) + ": " : ""}${newest.title}`
      : `${count} linked PRs (${openCount} open) — opens the newest:\n` +
        list.map((p) => `• ${p.title}${p.repo ? ` (${repoShort(p.repo)})` : ""}`).join("\n");

  return (
    <a
      href={newest.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex items-center gap-0.5 text-[0.625rem] font-semibold px-1.5 h-4 rounded border leading-none flex-shrink-0",
        "hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        TONE_CLASS[tone],
        className
      )}
      title={title}
      aria-label={`${count} linked pull request${count > 1 ? "s" : ""}; open newest in a new tab`}
    >
      <GitPullRequest className="h-3 w-3" aria-hidden="true" />
      {count}
    </a>
  );
}
