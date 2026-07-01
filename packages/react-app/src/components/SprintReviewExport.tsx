// SprintReviewExport (v1.35, ADR-045) — a form that combines the user's retro answers with pulled
// sprint data (duration, goals, points, fly-ins) and downloads a full sprint-review Field/Value CSV.

import { useState } from "react";
import { Download, FileText } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { matchFlyIn } from "./FlyInCard";
import { buildSprintReviewCsv, type SprintReviewForm } from "../lib/reportMarkdown";
import { formatPoints } from "../lib/format";
import type { SprintReport } from "../lib/types";

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function emptyForm(report: SprintReport): SprintReviewForm {
  return {
    teamName: "", scrumMaster: "", commitmentPoints: formatPoints(report.committedPoints),
    reasonForDelays: "", whatWorkedWell: "", whatDidNotWork: "", plannedImprovements: "", kudos: "",
  };
}

export function SprintReviewExport({ report }: { report: SprintReport }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<SprintReviewForm>(() => emptyForm(report));

  function onOpenChange(o: boolean) {
    if (o) setForm(emptyForm(report)); // reset + reseed commitment prefill each open
    setOpen(o);
  }
  const set =
    (k: keyof SprintReviewForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  function download() {
    const flyIns = [...report.completed, ...report.notCompleted]
      .filter((i) => matchFlyIn(i.summary))
      .map((i) => `${i.key}: ${i.summary}`);
    const csv = buildSprintReviewCsv(report, form, flyIns);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sprint-review-${slugify(report.sprint.name)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setOpen(false);
  }

  return (
    <>
      <Button variant="outline" size="sm" type="button" onClick={() => onOpenChange(true)}>
        <FileText className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
        Full report (CSV)
      </Button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Full sprint report — {report.sprint.name}</DialogTitle>
            <DialogDescription>
              Duration, goals, points, and fly-ins are pulled from the sprint. Fill in the rest, then export a CSV.
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
              <Label htmlFor="rv-commit" className="text-xs font-semibold">Commitment points <span className="font-normal text-muted-foreground">(prefilled from committed)</span></Label>
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

          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="button" onClick={download}>
              <Download className="h-4 w-4 mr-1.5" aria-hidden="true" />
              Export CSV
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
