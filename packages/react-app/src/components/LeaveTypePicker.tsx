// LeaveTypePicker (v1.39) — the leave-type "paint" selector, extracted from the Offset Tracker
// page so Planning's leaves/team calendar can reuse the exact same control (ADR-038 visuals).
//
// a11y: each type is a toggle button with aria-pressed; the ring marks the active choice.

import { LEAVE_TYPES } from "../lib/offset";
import type { LeaveType } from "../lib/types";
import { cn } from "@/lib/utils";

const PAINT_STYLE: Record<LeaveType, string> = {
  VL: "bg-[hsl(var(--info-bg))] text-[hsl(var(--info))]",
  EL: "bg-[hsl(var(--error-bg))] text-[hsl(var(--error))]",
  Holiday: "bg-[hsl(var(--success-bg))] text-[hsl(var(--success))]",
  Offset: "bg-[hsl(var(--accent)/0.12)] text-[hsl(var(--accent))]",
};
const PAINT_LABEL: Record<LeaveType, string> = {
  VL: "Vacation", EL: "Emergency", Holiday: "Holiday", Offset: "Offset",
};

export interface LeaveTypePickerProps {
  /** The currently selected paint type. */
  value: LeaveType;
  /** Called with the newly selected type. */
  onChange: (type: LeaveType) => void;
  /** Optional right-aligned hint text. */
  hint?: string;
}

export function LeaveTypePicker({ value, onChange, hint }: LeaveTypePickerProps) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-sm text-muted-foreground">Plot type:</span>
      {LEAVE_TYPES.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onChange(t)}
          aria-pressed={value === t}
          className={cn(
            "text-xs font-medium px-3 py-1.5 rounded-md transition-shadow",
            PAINT_STYLE[t],
            value === t ? "ring-2 ring-offset-1 ring-current" : "opacity-80 hover:opacity-100"
          )}
        >
          {PAINT_LABEL[t]}
        </button>
      ))}
      {hint && <span className="text-xs text-muted-foreground ml-auto">{hint}</span>}
    </div>
  );
}
