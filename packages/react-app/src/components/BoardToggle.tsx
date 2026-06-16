// BoardToggle — shared Dev/PO board segmented control (v1.6, ADR-017)
// Extracted from Dashboard in v1.7 (ADR-018) so Planning can reuse it.

import type { BoardKey } from "../lib/types";

// ── Props ─────────────────────────────────────────────────────────────────────

export interface BoardToggleProps {
  selectedKey: BoardKey;
  onChange: (key: BoardKey) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

/** Small segmented control for Dev / PO board selection. */
export function BoardToggle({ selectedKey, onChange }: BoardToggleProps) {
  // a11y: role="group" with aria-label announces the purpose of the buttons;
  //       each segment has aria-pressed so screen readers report the selection.
  return (
    <div
      role="group"
      aria-label="Board"
      className="flex items-center gap-1 rounded-md border border-border bg-muted p-0.5"
    >
      {(["dev", "po"] as const).map((key) => {
        const label = key === "dev" ? "Dev" : "PO";
        const pressed = selectedKey === key;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={pressed}
            onClick={() => onChange(key)}
            className={`
              px-3 py-1 rounded-sm text-xs font-semibold transition-colors
              ${pressed
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-background/60"}
            `}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
