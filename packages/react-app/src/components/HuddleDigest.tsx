import { useState } from "react";
import { type GetDailyHuddleOutput, type HuddleItem } from "../lib/types";
import { type McpError } from "../lib/mcpClient";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useCollapse } from "../hooks/useCollapse";
import { CollapseToggle } from "./CollapseToggle";
import {
  regroupByPerson,
  buildByPersonClipboardText,
  deriveInitials,
  type PersonGroup,
} from "../lib/huddleRegroup";

// ── Props ─────────────────────────────────────────────────────────────────────

interface HuddleDigestProps {
  data: GetDailyHuddleOutput | null;
  loading: boolean;
  error: McpError | null;
  onRefresh: () => void;
}

// ── View mode ─────────────────────────────────────────────────────────────────

type HuddleView = "by_status" | "by_person";

// ── Sub-components ────────────────────────────────────────────────────────────

interface HuddleSectionListProps {
  title: string;
  items: HuddleItem[];
  emptyText: string;
  titleClassName?: string;
}

function HuddleSectionList({
  title,
  items,
  emptyText,
  titleClassName,
}: HuddleSectionListProps) {
  return (
    <section className="mb-3.5">
      <h4
        className={cn(
          "text-[0.625rem] font-bold uppercase tracking-widest text-muted-foreground mb-1.5 pb-1 border-b border-border",
          titleClassName
        )}
      >
        {title}
      </h4>
      {items.length === 0 ? (
        <p className="text-muted-foreground text-xs py-0.5">{emptyText}</p>
      ) : (
        <ul className="flex flex-col" style={{ listStyle: "none" }}>
          {items.map((item) => (
            <li key={item.key} className="flex items-baseline gap-2 py-0.5 text-sm leading-snug">
              <span className="font-bold text-primary font-mono text-xs flex-shrink-0 w-[64px] truncate">
                {item.key}
              </span>
              <span className="text-foreground flex-1 break-words min-w-0">
                {item.summary}
              </span>
              {item.assignee && (
                <span className="text-[0.6875rem] text-muted-foreground flex-shrink-0 whitespace-nowrap">
                  {item.assignee}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── By-Person view ────────────────────────────────────────────────────────────

function PersonGroupSection({ group }: { group: PersonGroup }) {
  const name = group.assignee ?? "Unassigned";
  const hasItems =
    group.inProgress.length > 0 ||
    group.codeReview.length > 0 ||
    group.blocked.length > 0;

  return (
    <section className="mb-4">
      {/* Person header with initials avatar */}
      <div className="flex items-center gap-2 mb-2 pb-1 border-b border-border">
        <span
          className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-[0.625rem] font-bold flex-shrink-0"
          aria-hidden="true"
        >
          {group.initials}
        </span>
        <h4 className="text-xs font-semibold text-foreground uppercase tracking-wide">
          {name}
        </h4>
      </div>

      {!hasItems && (
        <p className="text-muted-foreground text-xs py-0.5 pl-1">No active items</p>
      )}

      {group.inProgress.length > 0 && (
        <ul className="flex flex-col mb-1" style={{ listStyle: "none" }}>
          {group.inProgress.map((item) => (
            <li key={item.key} className="flex items-baseline gap-2 py-0.5 text-sm leading-snug pl-1">
              <span className="font-bold text-primary font-mono text-xs flex-shrink-0 w-[64px] truncate">{item.key}</span>
              <span className="text-foreground flex-1 break-words min-w-0">{item.summary}</span>
              <span className="text-[0.6875rem] text-[hsl(var(--status-inprogress-text))] flex-shrink-0 whitespace-nowrap">In Progress</span>
            </li>
          ))}
        </ul>
      )}

      {group.codeReview.length > 0 && (
        <ul className="flex flex-col mb-1" style={{ listStyle: "none" }}>
          {group.codeReview.map((item) => (
            <li key={item.key} className="flex items-baseline gap-2 py-0.5 text-sm leading-snug pl-1">
              <span className="font-bold text-primary font-mono text-xs flex-shrink-0 w-[64px] truncate">{item.key}</span>
              <span className="text-foreground flex-1 break-words min-w-0">{item.summary}</span>
              <span className="text-[0.6875rem] text-[hsl(var(--status-codereview-text))] flex-shrink-0 whitespace-nowrap">Code Review</span>
            </li>
          ))}
        </ul>
      )}

      {group.blocked.length > 0 && (
        <ul className="flex flex-col" style={{ listStyle: "none" }}>
          {group.blocked.map((item) => (
            <li key={item.key} className="flex items-baseline gap-2 py-0.5 text-sm leading-snug pl-1">
              <span className="font-bold text-primary font-mono text-xs flex-shrink-0 w-[64px] truncate">{item.key}</span>
              <span className="text-foreground flex-1 break-words min-w-0">{item.summary}</span>
              <span className="text-[0.6875rem] text-destructive flex-shrink-0 whitespace-nowrap">⚠ Blocked</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── View toggle (By Status / By Person) ──────────────────────────────────────

interface ViewToggleProps {
  view: HuddleView;
  onChange: (v: HuddleView) => void;
}

function ViewToggle({ view, onChange }: ViewToggleProps) {
  return (
    // a11y: role="group" with label; each button uses aria-pressed
    <div
      role="group"
      aria-label="Huddle grouping"
      className="flex rounded-md border border-border overflow-hidden text-xs"
    >
      <button
        type="button"
        role="tab"
        aria-pressed={view === "by_status"}
        aria-selected={view === "by_status"}
        onClick={() => onChange("by_status")}
        className={cn(
          "px-2.5 py-1 font-semibold transition-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          view === "by_status"
            ? "bg-primary text-primary-foreground"
            : "bg-background text-muted-foreground hover:text-foreground hover:bg-muted/50"
        )}
      >
        By Status
      </button>
      <button
        type="button"
        role="tab"
        aria-pressed={view === "by_person"}
        aria-selected={view === "by_person"}
        onClick={() => onChange("by_person")}
        className={cn(
          "px-2.5 py-1 font-semibold transition-card border-l border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          view === "by_person"
            ? "bg-primary text-primary-foreground"
            : "bg-background text-muted-foreground hover:text-foreground hover:bg-muted/50"
        )}
      >
        By Person
      </button>
    </div>
  );
}

// ── Build plain-text digest for "By Status" clipboard ────────────────────────

function buildByStatusPlainText(data: GetDailyHuddleOutput): string {
  const lines: string[] = [
    `=== Daily Huddle: ${data.sprintName} ===`,
    data.summaryText,
    "",
  ];

  const renderSection = (title: string, items: HuddleItem[]) => {
    lines.push(`--- ${title} ---`);
    if (items.length === 0) {
      lines.push("(none)");
    } else {
      for (const item of items) {
        const assignee = item.assignee ? ` [${item.assignee}]` : "";
        lines.push(`  ${item.key}: ${item.summary}${assignee}`);
      }
    }
    lines.push("");
  };

  renderSection("In Progress", data.inProgress);
  renderSection("Code Review", data.codeReview);
  renderSection("Blocked", data.blocked);
  renderSection("Done", data.done);
  renderSection("Up Next", data.upNext);

  lines.push(`Generated at: ${new Date(data.generatedAt).toLocaleString()}`);
  return lines.join("\n");
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function HuddleSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading huddle digest">
      <Skeleton className="h-14 w-full mb-4 rounded-md" />
      {(["In Progress", "Code Review", "Blocked", "Done", "Up Next"] as const).map((s) => (
        <div key={s} className="mt-3">
          <Skeleton className="h-2.5 w-1/3 mb-1.5" />
          <Skeleton className="h-3.5 w-11/12 mb-1" />
          <Skeleton className="h-3.5 w-4/5" />
        </div>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function HuddleDigest({ data, loading, error, onRefresh }: HuddleDigestProps) {
  const [copied, setCopied] = useState(false);
  // v1.3: By Status / By Person toggle
  // v1.3.1: By Person is the default huddle view (walk-the-board-by-person standup)
  const [view, setView] = useState<HuddleView>("by_person");
  // v1.43: collapsible (hook must precede the early returns below — rules of hooks)
  const [collapsed, toggleCollapsed] = useCollapse("huddleDigest");

  const handleCopy = async () => {
    if (!data) return;

    let text: string;
    if (view === "by_person") {
      const groups = regroupByPerson(data);
      text = buildByPersonClipboardText(data.sprintName, groups);
    } else {
      text = buildByStatusPlainText(data);
    }

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard fallback for older browsers / insecure contexts
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.focus();
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <h3 className="text-base font-semibold text-foreground">Daily Huddle</h3>
        </CardHeader>
        <CardContent>
          <HuddleSkeleton />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    const isBridgeDown = error.code === "BRIDGE_DOWN";
    return (
      <Card>
        <CardHeader className="pb-3">
          <h3 className="text-base font-semibold text-foreground">Daily Huddle</h3>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive" role="alert">
            <AlertTitle>
              {isBridgeDown ? "Jira bridge is offline" : `Error: ${error.code}`}
            </AlertTitle>
            <AlertDescription>
              <p>{error.message}</p>
              {isBridgeDown && (
                <code className="block font-mono bg-background border border-destructive/30 rounded px-2 py-1 mt-2 text-[0.8125rem] w-fit">
                  npm run dev:jira:http
                </code>
              )}
              <Button
                variant="destructive"
                size="sm"
                className="mt-2.5"
                onClick={onRefresh}
                type="button"
              >
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <h3 className="text-base font-semibold text-foreground">Daily Huddle</h3>
        </CardHeader>
        <CardContent>
          <div className="py-4 text-center text-muted-foreground text-sm">
            <p>No huddle data available.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // v1.2: include codeReview in empty check
  const isEmpty =
    data.inProgress.length === 0 &&
    data.codeReview.length === 0 &&
    data.blocked.length === 0 &&
    data.done.length === 0 &&
    data.upNext.length === 0;

  if (isEmpty) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <h3 className="text-base font-semibold text-foreground">
            Daily Huddle — {data.sprintName}
          </h3>
        </CardHeader>
        <CardContent>
          <div className="py-4 text-center text-muted-foreground">
            <p className="text-base font-semibold text-foreground mb-1">No sprint activity</p>
            <p className="text-sm">There are no issues assigned to active team members yet.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // v1.3: By-Person regroup (pure client)
  const personGroups = view === "by_person" ? regroupByPerson(data) : [];

  return (
    <Card>
      {/* a11y: labelled region with heading */}
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-base font-semibold text-foreground leading-snug min-w-0 flex-1">
            <CollapseToggle collapsed={collapsed} onToggle={toggleCollapsed} className="w-full">
              <span className="truncate">Daily Huddle — {data.sprintName}</span>
            </CollapseToggle>
          </h3>

          {!collapsed && (
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* v1.3: By Status / By Person segmented toggle */}
            <ViewToggle view={view} onChange={setView} />

            {/* Copy button */}
            {/* a11y: descriptive aria-label */}
            <Button
              type="button"
              size="sm"
              variant={copied ? "secondary" : "default"}
              onClick={handleCopy}
              aria-label={copied ? "Digest copied to clipboard" : "Copy digest to clipboard"}
            >
              {copied ? "✓ Copied!" : "Copy"}
            </Button>
          </div>
          )}
        </div>

        {/* Summary — shown in both views; summaryText unchanged (contract) */}
        {!collapsed && (
        <div className="mt-2.5 text-sm text-foreground leading-relaxed px-3 py-2.5 bg-muted rounded-md border-l-4 border-primary">
          {data.summaryText}
        </div>
        )}
      </CardHeader>

      {!collapsed && (
      <CardContent className="pt-1">
        <Separator className="mb-3" />

        {view === "by_status" ? (
          /* ── By Status view (original layout, unchanged) ── */
          <>
            <HuddleSectionList
              title="In Progress"
              items={data.inProgress}
              emptyText="Nothing in progress"
            />
            {/* v1.2: Code Review section — between In Progress and Blocked (ADR-008) */}
            <HuddleSectionList
              title="Code Review"
              items={data.codeReview}
              emptyText="Nothing in review"
              titleClassName="text-[hsl(var(--status-codereview-text))]"
            />
            <HuddleSectionList
              title="Blocked"
              items={data.blocked}
              emptyText="No blockers"
            />
            <HuddleSectionList
              title="Done"
              items={data.done}
              emptyText="Nothing completed yet"
            />
            <HuddleSectionList
              title="Up Next"
              items={data.upNext}
              emptyText="Nothing queued"
            />
          </>
        ) : (
          /* ── By Person view (v1.3, ADR-010) ── */
          <>
            {personGroups.length === 0 ? (
              <p className="text-muted-foreground text-xs py-2">No active items to group by person.</p>
            ) : (
              personGroups.map((group) => (
                <PersonGroupSection
                  key={group.assignee ?? "__unassigned__"}
                  group={group}
                />
              ))
            )}
          </>
        )}

        <p className="text-[0.6875rem] text-muted-foreground mt-2">
          Updated {new Date(data.generatedAt).toLocaleString()}
        </p>
      </CardContent>
      )}
    </Card>
  );
}

// keep named export so consumers can reference deriveInitials from huddleRegroup if needed
export { deriveInitials };
