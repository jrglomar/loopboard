// RetroCard (v1.42, ADR-052) — the persisted sprint retrospective on the Reports page.
// Presentational: five free-text fields seeded from the store, saved via onSave. The same
// stored retro pre-fills the Full-report export dialog, so the retro is written once.

import { useEffect, useState } from "react";
import { ClipboardList, AlertCircle, Check } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { RetroData, RetroFields } from "../lib/retroClient";

const EMPTY: RetroFields = {
  reasonForDelays: "", whatWorkedWell: "", whatDidNotWork: "", plannedImprovements: "", kudos: "",
};

const FIELDS: { key: keyof RetroFields; label: string }[] = [
  { key: "reasonForDelays", label: "Reason for delays / incomplete tasks" },
  { key: "whatWorkedWell", label: "What worked well this sprint" },
  { key: "whatDidNotWork", label: "What did not work well" },
  { key: "plannedImprovements", label: "Planned improvements for next sprint" },
  { key: "kudos", label: "Kudos" },
];

function toFields(retro: RetroData | null): RetroFields {
  if (!retro) return { ...EMPTY };
  return {
    reasonForDelays: retro.reasonForDelays,
    whatWorkedWell: retro.whatWorkedWell,
    whatDidNotWork: retro.whatDidNotWork,
    plannedImprovements: retro.plannedImprovements,
    kudos: retro.kudos,
  };
}

export function RetroCard({
  retro,
  onSave,
  disabled = false,
  loading = false,
}: {
  retro: RetroData | null;
  onSave: (fields: RetroFields) => Promise<void>;
  /** True when no sprint is selected. */
  disabled?: boolean;
  loading?: boolean;
}) {
  const [form, setForm] = useState<RetroFields>(() => toFields(retro));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  // Re-seed from the store when the stored retro changes (sprint switch / reload / after save).
  useEffect(() => {
    setForm(toFields(retro));
  }, [retro]);

  const set =
    (k: keyof RetroFields) =>
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setJustSaved(false);
      setForm((f) => ({ ...f, [k]: e.target.value }));
    };

  const dirty = JSON.stringify(form) !== JSON.stringify(toFields(retro));

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(form);
      setJustSaved(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const updatedLabel = retro
    ? new Date(retro.updatedAt).toLocaleString([], {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
      })
    : null;

  return (
    <Card className="shadow-sm">
      <CardHeader className="px-4 pt-4 pb-2">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          <ClipboardList className="h-4 w-4 text-primary" aria-hidden="true" />
          Retrospective
          {loading && (
            <span className="text-[0.6875rem] font-normal text-muted-foreground animate-pulse ml-1">
              Loading…
            </span>
          )}
          {updatedLabel && (
            <span className="ml-auto text-[0.6875rem] font-normal text-muted-foreground">
              Saved {updatedLabel}
            </span>
          )}
        </h3>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        {disabled ? (
          <p className="text-sm text-muted-foreground">Select a sprint to record its retrospective.</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Written once here and pre-filled into the Full report export.
            </p>
            {FIELDS.map((f) => (
              <div key={f.key}>
                <Label htmlFor={`retro-${f.key}`} className="text-xs font-semibold">{f.label}</Label>
                <Textarea
                  id={`retro-${f.key}`}
                  rows={2}
                  value={form[f.key]}
                  onChange={set(f.key)}
                  disabled={saving}
                />
              </div>
            ))}
            {saveError && (
              <p className="text-xs text-destructive flex items-center gap-1" role="alert">
                <AlertCircle className="h-3 w-3 flex-shrink-0" aria-hidden="true" /> {saveError}
              </p>
            )}
            <div className="flex items-center justify-end gap-2">
              {justSaved && !dirty && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Check className="h-3 w-3 text-primary" aria-hidden="true" /> Saved
                </span>
              )}
              <Button
                type="button" size="sm" className="h-8"
                onClick={() => void handleSave()}
                disabled={saving || !dirty}
              >
                {saving ? "Saving…" : "Save retrospective"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
