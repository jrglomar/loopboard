import { useState } from "react";
import { Dashboard } from "./pages/Dashboard";
import { Planning } from "./pages/Planning";
import { Reports } from "./pages/Reports";
import { cn } from "@/lib/utils";

// ── Tab types ─────────────────────────────────────────────────────────────────

// v1.7 (ADR-018): "Ticket Generator" tab removed; replaced by "Planning" tab.
// Ticket generation now lives inside the Planning page.
type Tab = "dashboard" | "planning" | "reports";

const TABS: { id: Tab; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "planning", label: "Planning" },
  { id: "reports", label: "Reports" },
];

// ── App Shell ─────────────────────────────────────────────────────────────────

// a11y: semantic landmarks — <header>, <nav>, <main>
export function App() {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");

  return (
    // a11y: flex column, full viewport height
    <div className="flex flex-col min-h-screen bg-background">

      {/* ── Combined sticky header + tab nav ── */}
      <header
        className="sticky top-0 z-50 bg-card border-b border-border shadow-sm"
        role="banner"
      >
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6">

          {/* Top row: logo + context pill */}
          <div className="flex items-center gap-3 h-12">
            <span className="text-[1.0625rem] font-bold tracking-tight text-foreground flex-shrink-0 select-none">
              Loop<span className="text-primary">board</span>
            </span>
            <span
              className="text-[0.6875rem] font-semibold px-2 py-0.5 bg-primary/10 text-primary rounded-full whitespace-nowrap"
              aria-label="Product version"
            >
              v1.7
            </span>
            {/* Spacer */}
            <div className="flex-1" />
          </div>

          {/* Tab navigation — sits inside the same header element */}
          {/* a11y: <nav> landmark with aria-label */}
          <nav aria-label="Main navigation" className="-mx-0.5">
            <div className="flex" role="tablist" aria-label="Page tabs">
              {TABS.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  // a11y: aria-pressed signals active tab to screen readers
                  aria-pressed={activeTab === id}
                  aria-current={activeTab === id ? "page" : undefined}
                  aria-selected={activeTab === id}
                  onClick={() => setActiveTab(id)}
                  className={cn(
                    "relative px-4 py-2.5 text-sm font-medium transition-colors duration-150 whitespace-nowrap",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-sm",
                    // Active: indigo bottom border + primary text
                    activeTab === id
                      ? "text-primary after:absolute after:bottom-0 after:inset-x-0 after:h-[3px] after:bg-primary after:rounded-t-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </nav>
        </div>
      </header>

      {/* ── Main content ── */}
      {/* a11y: main landmark wraps page content */}
      <main
        className="flex-1 max-w-[1400px] w-full mx-auto px-4 sm:px-6 py-5"
        id="main-content"
      >
        {activeTab === "dashboard" && <Dashboard />}
        {activeTab === "planning" && <Planning />}
        {activeTab === "reports" && <Reports />}
      </main>
    </div>
  );
}
