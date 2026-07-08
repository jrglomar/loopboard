// CollapseToggle (v1.43) — a disclosure button for Huddle card headers. Renders a chevron
// followed by the card's own icon/title (passed as children), so the whole title row toggles
// the card body. Kept INSIDE each card's <h3> to preserve heading semantics + text queries.

import { ChevronDown, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function CollapseToggle({
  collapsed,
  onToggle,
  className,
  children,
}: {
  collapsed: boolean;
  onToggle: () => void;
  className?: string;
  children: ReactNode;
}) {
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      className={cn(
        "flex items-center gap-1.5 min-w-0 text-left rounded",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
    >
      <Chevron className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
      {children}
    </button>
  );
}
