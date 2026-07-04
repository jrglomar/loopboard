import { useState } from "react";
import { LayoutDashboard, CalendarRange, CalendarDays, Link2, BarChart3 } from "lucide-react";
import { Dashboard } from "./pages/Dashboard";
import { Planning } from "./pages/Planning";
import { Leaves } from "./pages/Leaves";
import { Linking } from "./pages/Linking";
import { Reports } from "./pages/Reports";
import { AssistantWidget } from "./components/AssistantWidget";
import { BoardToggle } from "./components/BoardToggle";
import { useBoards } from "./lib/boards";
import type { BoardKey } from "./lib/types";
import { cn } from "@/lib/utils";

// ── Tab types ─────────────────────────────────────────────────────────────────

// v1.7 (ADR-018): "Ticket Generator" tab removed; replaced by "Planning" tab.
// v1.11 (ADR-022): "Linking" tab added (bulk PO→Dev ticket creation).
type Tab = "dashboard" | "planning" | "leaves" | "linking" | "reports";

const TABS: { id: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", label: "Huddle", icon: LayoutDashboard },
  { id: "planning", label: "Planning", icon: CalendarRange },
  { id: "leaves", label: "Offset Tracker", icon: CalendarDays },
  { id: "linking", label: "Linking", icon: Link2 },
  { id: "reports", label: "Reports", icon: BarChart3 },
];

// ── App Shell ─────────────────────────────────────────────────────────────────

// a11y: semantic landmarks — <header> top bar (brand + nav + board controls), <main>.
// v1.39 (ADR-049): navigation moved BACK to a single top header (was a left sidebar,
// v1.24/ADR-036); the main column is now FULL-WIDTH with compact paddings so every
// page gets the whole viewport.
export function App() {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");

  // v1.13 (ADR-024): shared board + sprint context across Dashboard/Planning/Reports.
  // sprintId is the EXPLICIT pick (null = none → each page applies its own default).
  const { boards } = useBoards();
  const [boardKey, setBoardKey] = useState<BoardKey>("dev");
  const [sprintId, setSprintId] = useState<number | null>(null);
  // v1.25 (ADR-037): active project index per side; the top-bar dropdown picks it.
  const [devProjectIdx, setDevProjectIdx] = useState(0);
  const [poProjectIdx, setPoProjectIdx] = useState(0);
  const projectIdx = boardKey === "dev" ? devProjectIdx : poProjectIdx;
  const activeProjects = boards ? boards[boardKey] : [];
  const setActiveProjectIdx = (i: number) => {
    if (boardKey === "dev") setDevProjectIdx(i); else setPoProjectIdx(i);
    setSprintId(null); // project switch invalidates the explicit sprint pick
  };
  const shared = {
    boardKey,
    sprintId,
    projectIdx,
    onBoardChange: (k: BoardKey) => { setBoardKey(k); setSprintId(null); },
    onSprintChange: (id: number) => setSprintId(id),
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">

      {/* ── Top header: brand · nav · board controls · version ── */}
      <header
        role="banner"
        className="sticky top-0 z-40 bg-card border-b border-border"
      >
        <div className="h-12 flex items-center gap-2 sm:gap-4 px-3 sm:px-5">
          {/* Brand */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <LayoutDashboard className="h-4 w-4 text-primary" aria-hidden="true" />
            </span>
            <span className="text-[1.0625rem] font-bold tracking-tight text-foreground select-none whitespace-nowrap">
              Loop<span className="text-primary">board</span>
            </span>
          </div>

          {/* Navigation — horizontal tabs in the header (v1.39) */}
          {/* a11y: <nav> landmark with aria-label; role=tab semantics preserved */}
          {/* perf: overflow-x-auto keeps all 5 tabs reachable on narrow viewports */}
          <nav aria-label="Main navigation" className="flex-1 min-w-0 overflow-x-auto">
            <div className="flex items-center gap-0.5" role="tablist" aria-label="Page tabs">
              {TABS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-pressed={activeTab === id}
                  aria-current={activeTab === id ? "page" : undefined}
                  aria-selected={activeTab === id}
                  onClick={() => setActiveTab(id)}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[0.8125rem] font-medium transition-colors whitespace-nowrap",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                    activeTab === id
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                >
                  <Icon className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                  {/* a11y: label always visible — the tablist scrolls horizontally on narrow screens */}
                  {label}
                </button>
              ))}
            </div>
          </nav>

          {/* Right side: board selection (hidden on Linking — dual-board) + version */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {activeTab !== "linking" && (
              <>
                <span className="hidden md:inline text-[0.625rem] font-semibold text-muted-foreground uppercase tracking-wide">
                  Board
                </span>
                <BoardToggle selectedKey={boardKey} onChange={shared.onBoardChange} />
                {/* v1.25 (ADR-037): project picker for the active side (only when >1 project) */}
                {activeProjects.length > 1 && (
                  <select
                    aria-label="Project"
                    value={projectIdx}
                    onChange={(e) => setActiveProjectIdx(Number(e.target.value))}
                    className="h-8 rounded-md border border-border bg-card px-2 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {activeProjects.map((p, i) => (
                      <option key={p.projectKey} value={i}>{p.projectKey}</option>
                    ))}
                  </select>
                )}
              </>
            )}
            <span
              className="text-[0.625rem] font-semibold px-1.5 py-0.5 bg-primary/10 text-primary rounded-full whitespace-nowrap"
              aria-label="Product version"
            >
              v{__APP_VERSION__}
            </span>
          </div>
        </div>
      </header>

      {/* a11y: main landmark wraps page content */}
      {/* v1.39: full-width with a SOFT cap — pages span the viewport on normal monitors;
          the 1800px ceiling only engages on ultrawides so content never gets gangly. */}
      <main className="flex-1 w-full max-w-[1800px] mx-auto px-3 sm:px-5 py-4" id="main-content">
        {activeTab === "dashboard" && <Dashboard {...shared} />}
        {activeTab === "planning" && <Planning {...shared} />}
        {activeTab === "leaves" && <Leaves {...shared} />}
        {activeTab === "linking" && <Linking />}
        {activeTab === "reports" && <Reports {...shared} />}
      </main>

      {/* v1.19 (ADR-030): global floating AI assistant (FAB lower-right) */}
      <AssistantWidget />
    </div>
  );
}
