// TrendsView — "Trends & KPIs" mode orchestrator for the Reports page (v1.59, ADR-071).
//
// Props-driven — NO context hooks (useAuth/useBoards/usePolicy): only data hooks
// (useSprintList, useMultiSprintReport), so this renders fine in provider-less tests.
// Reports.tsx already resolved boardId/boardKey before mounting this.
//
// Selection modes (SprintRangePicker): "recent" (default, last 10 closed sprints),
// "pick" (checked sprints, chronological), "range" (native date inputs, active+closed only).
// Each mode resolves to concrete sprint ids via sprintRange.ts, which feed useMultiSprintReport
// — get_multi_sprint_report only ever receives `sprintIds` (CONTRACTS.md §4.29).

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Copy, Download, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useSprintList, useMultiSprintReport } from "../../hooks/useJira";
import { lastNClosedSprintIds, sprintIdsInDateRange } from "../../lib/sprintRange";
import { buildMultiSprintMarkdown, buildMultiSprintCsv } from "../../lib/reportMarkdown";
import { saveBlob, slugify } from "../SprintReviewExport";
import { SprintRangePicker, type TrendsSelectionMode } from "./SprintRangePicker";
import { MultiSprintTable } from "./MultiSprintTable";
import { TeamKpiSection } from "./TeamKpiSection";
import { DeveloperKpiSection } from "./DeveloperKpiSection";
import type { McpError } from "../../lib/mcpClient";
import type { SprintRef } from "../../lib/types";

const DEFAULT_LAST_N = 10;

export interface TrendsViewProps {
  boardId: number;
  boardKey?: string;
}

/** Sort a set of picked sprint ids chronologically (oldest → newest) using the full sprint list. */
function chronologicalIds(sprints: SprintRef[], ids: number[]): number[] {
  const idSet = new Set(ids);
  const matched = sprints.filter((s) => idSet.has(s.id));
  return [...matched]
    .sort((a, b) => {
      const at = a.startDate ? Date.parse(a.startDate) : Number.POSITIVE_INFINITY;
      const bt = b.startDate ? Date.parse(b.startDate) : Number.POSITIVE_INFINITY;
      if (at !== bt) return at - bt;
      return a.id - b.id;
    })
    .map((s) => s.id);
}

// ── Loading / error helpers (house style — mirrors Reports.tsx) ───────────────

function TrendsSkeleton({ label }: { label: string }) {
  return (
    <Card className="shadow-sm">
      <CardContent className="pt-5">
        <div aria-busy="true" aria-label={label} className="space-y-4">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-32 w-full rounded-lg" />
        </div>
      </CardContent>
    </Card>
  );
}

function TrendsErrorAlert({ error, onRetry }: { error: McpError; onRetry: () => void }) {
  const isBridgeDown = error.code === "BRIDGE_DOWN";
  return (
    <Alert variant="destructive" role="alert">
      <AlertCircle className="h-4 w-4" aria-hidden="true" />
      <AlertTitle>{isBridgeDown ? "Jira bridge is offline" : `Error: ${error.code}`}</AlertTitle>
      <AlertDescription>
        <p>{error.message}</p>
        <Button variant="destructive" size="sm" className="mt-2.5" onClick={onRetry} type="button">
          Retry
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="text-center py-12 text-muted-foreground">
      <TrendingUp className="h-10 w-10 mx-auto mb-3 opacity-40" aria-hidden="true" />
      <p className="text-base font-medium text-foreground">{title}</p>
      <p className="text-sm mt-1">{hint}</p>
    </div>
  );
}

export function TrendsView({ boardId, boardKey }: TrendsViewProps) {
  const [mode, setMode] = useState<TrendsSelectionMode>("recent");
  const [lastN, setLastN] = useState(DEFAULT_LAST_N);
  const [pickedIds, setPickedIds] = useState<number[]>([]);
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [copied, setCopied] = useState(false);

  // Board switch invalidates any picked/range selection made against the old board's sprints.
  useEffect(() => {
    setPickedIds([]);
    setRangeStart("");
    setRangeEnd("");
  }, [boardId]);

  const sprintList = useSprintList("all", boardId);
  const active = sprintList.data?.active ?? [];
  const closed = sprintList.data?.closed ?? [];
  const allSprints = useMemo(() => [...active, ...closed], [active, closed]);

  function togglePicked(id: number) {
    setPickedIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  const sprintIds = useMemo(() => {
    if (mode === "recent") return lastNClosedSprintIds(closed, lastN);
    if (mode === "pick") return chronologicalIds(allSprints, pickedIds);
    return sprintIdsInDateRange(allSprints, rangeStart, rangeEnd);
  }, [mode, closed, lastN, allSprints, pickedIds, rangeStart, rangeEnd]);

  const hasSelection = sprintIds.length > 0;
  const reportState = useMultiSprintReport(hasSelection ? sprintIds : null);
  const report = reportState.data;

  async function handleCopy() {
    if (!report) return;
    const md = buildMultiSprintMarkdown(report);
    try {
      await navigator.clipboard.writeText(md);
    } catch {
      // Fallback for older browsers / insecure contexts
      const el = document.createElement("textarea");
      el.value = md;
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
  }

  function handleDownloadMd() {
    if (!report) return;
    const base = `trends-${slugify(boardKey ?? String(boardId))}`;
    saveBlob(new Blob([buildMultiSprintMarkdown(report)], { type: "text/markdown;charset=utf-8" }), `${base}.md`);
  }

  function handleDownloadCsv() {
    if (!report) return;
    const base = `trends-${slugify(boardKey ?? String(boardId))}`;
    saveBlob(new Blob([buildMultiSprintCsv(report)], { type: "text/csv;charset=utf-8" }), `${base}.csv`);
  }

  const emptySelectionHint =
    mode === "pick"
      ? "Check one or more sprints above to see trends."
      : mode === "range"
        ? "Pick a start and end date above to see trends."
        : "This board has no closed sprints yet.";

  return (
    <div className="space-y-4">
      <SprintRangePicker
        mode={mode}
        onModeChange={setMode}
        lastN={lastN}
        onLastNChange={setLastN}
        active={active}
        closed={closed}
        pickedIds={pickedIds}
        onTogglePicked={togglePicked}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        onRangeStartChange={setRangeStart}
        onRangeEndChange={setRangeEnd}
      />

      {sprintList.loading && <TrendsSkeleton label="Loading sprints" />}

      {!sprintList.loading && sprintList.error && (
        <TrendsErrorAlert error={sprintList.error} onRetry={sprintList.run} />
      )}

      {!sprintList.loading && !sprintList.error && !hasSelection && (
        <EmptyState title="No sprints selected" hint={emptySelectionHint} />
      )}

      {!sprintList.loading && !sprintList.error && hasSelection && reportState.loading && (
        <TrendsSkeleton label="Loading trends report" />
      )}

      {!sprintList.loading && !sprintList.error && hasSelection && !reportState.loading && reportState.error && (
        <TrendsErrorAlert error={reportState.error} onRetry={reportState.run} />
      )}

      {!sprintList.loading &&
        !sprintList.error &&
        hasSelection &&
        !reportState.loading &&
        !reportState.error &&
        report &&
        report.sprintCount === 0 && (
          <EmptyState title="No data for this window" hint="Try a different sprint selection." />
        )}

      {!sprintList.loading &&
        !sprintList.error &&
        hasSelection &&
        !reportState.loading &&
        !reportState.error &&
        report &&
        report.sprintCount > 0 && (
          <>
            {/* Export bar — Copy markdown / Download .md / Download .csv */}
            <div role="toolbar" aria-label="Export trends report" className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide mr-1">
                Export
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopy}
                type="button"
                aria-label={copied ? "Trends report copied to clipboard" : "Copy trends report as Markdown"}
              >
                <Copy className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
                {copied ? "Copied!" : "Copy"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownloadMd}
                type="button"
                aria-label="Download trends report as Markdown"
              >
                <Download className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
                .md
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownloadCsv}
                type="button"
                aria-label="Download trends report as CSV"
              >
                <Download className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
                .csv
              </Button>
            </div>

            <MultiSprintTable report={report} />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <TeamKpiSection report={report} />
              <DeveloperKpiSection report={report} />
            </div>
          </>
        )}
    </div>
  );
}
