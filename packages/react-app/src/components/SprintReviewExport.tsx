// SprintReviewExport (v1.35, ADR-045; v1.38, ADR-048) — a form that combines the user's retro
// answers with pulled sprint data (duration, goals, points, fly-ins) + a per-member table
// (committed/completed points, leaves by type, offset balance) and exports it three ways:
// a Field/Value CSV, a styled .xlsx workbook, or a print-ready HTML report (→ PDF).

import { useState } from "react";
import { FileText, FileSpreadsheet, Printer } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { matchFlyIn } from "./FlyInCard";
import type { SprintReviewForm } from "../lib/reportMarkdown";
import { buildSprintReviewHtml, buildMemberReviewTable } from "../lib/sprintReview";
import { sprintReviewXlsxArray } from "../lib/sprintReviewXlsx";
import { formatPoints } from "../lib/format";
import type { SprintReport } from "../lib/types";
import type { LeavesMap } from "../lib/leavesClient";
import type { OffsetLedger } from "../lib/offsetClient";
import type { RetroFields } from "../lib/retroClient";

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// v1.42 (ADR-052): the retro fields are pre-filled from the persisted store when present,
// so they don't have to be retyped at export time.
function emptyForm(commitment: number, retro?: RetroFields | null): SprintReviewForm {
  return {
    teamName: "", scrumMaster: "", commitmentPoints: formatPoints(commitment),
    reasonForDelays: retro?.reasonForDelays ?? "",
    whatWorkedWell: retro?.whatWorkedWell ?? "",
    whatDidNotWork: retro?.whatDidNotWork ?? "",
    plannedImprovements: retro?.plannedImprovements ?? "",
    kudos: retro?.kudos ?? "",
  };
}

/** The retro subset of the export form (persisted back to the store on export). */
function retroFromForm(form: SprintReviewForm): RetroFields {
  return {
    reasonForDelays: form.reasonForDelays,
    whatWorkedWell: form.whatWorkedWell,
    whatDidNotWork: form.whatDidNotWork,
    plannedImprovements: form.plannedImprovements,
    kudos: form.kudos,
  };
}

/** Trigger a browser download of a Blob under a filename. */
function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Open the print-ready HTML in a new window and trigger the print/PDF dialog. */
function printHtml(html: string) {
  const w = window.open("", "_blank");
  if (!w) return; // popup blocked / unavailable (e.g. jsdom) — no-op
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 250); // let the styles/layout settle first
}

export function SprintReviewExport({
  report,
  leaves,
  ledger,
  requiredPoints,
  roster,
  retro,
  onPersistRetro,
}: {
  report: SprintReport;
  leaves: LeavesMap | null;
  ledger: OffsetLedger | null;
  /** v1.38: required points (N) — per-member committed = max(0, N − leave days). */
  requiredPoints: number;
  /** v1.38: dev roster names — committed total = Σ capacity over the whole team. */
  roster: string[];
  /** v1.42 (ADR-052): persisted retro to pre-fill the form (null = none saved yet). */
  retro?: RetroFields | null;
  /** v1.42: persist the typed retro fields back to the store on export (non-fatal). */
  onPersistRetro?: (fields: RetroFields) => Promise<void>;
}) {
  // Commitment (summary) = total developer capacity = Σ max(0, N − leave days) over the roster.
  const capacityCommitment = buildMemberReviewTable(report, leaves, ledger, requiredPoints, roster).totals.committedPoints;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<SprintReviewForm>(() => emptyForm(capacityCommitment, retro));

  function onOpenChange(o: boolean) {
    if (o) setForm(emptyForm(capacityCommitment, retro)); // reset + reseed capacity commitment + saved retro each open
    setOpen(o);
  }

  // Persist typed retro fields back to the store (non-fatal — never blocks the download).
  function persistRetro() {
    if (!onPersistRetro) return;
    void onPersistRetro(retroFromForm(form)).catch(() => { /* best-effort */ });
  }
  const set =
    (k: keyof SprintReviewForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const flyIns = () =>
    [...report.completed, ...report.notCompleted]
      .filter((i) => matchFlyIn(i.summary))
      .map((i) => `${i.key}: ${i.summary}`);

  const base = `sprint-review-${slugify(report.sprint.name)}`;

  function exportXlsx() {
    const bytes = sprintReviewXlsxArray(report, form, flyIns(), leaves, ledger, requiredPoints, roster);
    saveBlob(
      new Blob([bytes], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      `${base}.xlsx`
    );
    persistRetro();
    setOpen(false);
  }

  function exportPrint() {
    printHtml(buildSprintReviewHtml(report, form, flyIns(), leaves, ledger, requiredPoints, roster));
    persistRetro();
    setOpen(false);
  }

  return (
    <>
      <Button variant="outline" size="sm" type="button" onClick={() => onOpenChange(true)}>
        <FileText className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
        Full report
      </Button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Full sprint report — {report.sprint.name}</DialogTitle>
            <DialogDescription>
              Duration, goals, points, fly-ins, and each member's points + leaves/offsets are pulled from the
              sprint. Fill in the rest, then download as PDF or a styled spreadsheet.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="rv-team" className="text-xs font-semibold">Team name</Label>
                <Input id="rv-team" value={form.teamName} onChange={set("teamName")} />
              </div>
              <div>
                <Label htmlFor="rv-sm" className="text-xs font-semibold">Scrum master</Label>
                <Input id="rv-sm" value={form.scrumMaster} onChange={set("scrumMaster")} />
              </div>
            </div>
            <div>
              <Label htmlFor="rv-commit" className="text-xs font-semibold">Commitment points <span className="font-normal text-muted-foreground">(team capacity = N − leaves)</span></Label>
              <Input id="rv-commit" value={form.commitmentPoints} onChange={set("commitmentPoints")} className="max-w-[160px]" />
            </div>
            <div>
              <Label htmlFor="rv-delays" className="text-xs font-semibold">Reason for delays / incomplete tasks</Label>
              <Textarea id="rv-delays" rows={2} value={form.reasonForDelays} onChange={set("reasonForDelays")} />
            </div>
            <div>
              <Label htmlFor="rv-well" className="text-xs font-semibold">What worked well this sprint</Label>
              <Textarea id="rv-well" rows={2} value={form.whatWorkedWell} onChange={set("whatWorkedWell")} />
            </div>
            <div>
              <Label htmlFor="rv-bad" className="text-xs font-semibold">What did not work well</Label>
              <Textarea id="rv-bad" rows={2} value={form.whatDidNotWork} onChange={set("whatDidNotWork")} />
            </div>
            <div>
              <Label htmlFor="rv-improve" className="text-xs font-semibold">Planned improvements for next sprint</Label>
              <Textarea id="rv-improve" rows={2} value={form.plannedImprovements} onChange={set("plannedImprovements")} />
            </div>
            <div>
              <Label htmlFor="rv-kudos" className="text-xs font-semibold">Kudos</Label>
              <Textarea id="rv-kudos" rows={2} value={form.kudos} onChange={set("kudos")} />
            </div>
          </div>

          {/* v1.39: plain CSV removed — PDF + the styled spreadsheet are the two outputs */}
          <DialogFooter className="flex-wrap gap-2">
            <Button variant="outline" type="button" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="outline" type="button" onClick={exportPrint}>
              <Printer className="h-4 w-4 mr-1.5" aria-hidden="true" /> Download as PDF
            </Button>
            <Button type="button" onClick={exportXlsx}>
              <FileSpreadsheet className="h-4 w-4 mr-1.5" aria-hidden="true" /> Download as CSV (Styled Format)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
