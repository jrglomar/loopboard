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
  { id: "leaves", label: "Leaves", icon: CalendarDays },
  { id: "linking", label: "Linking", icon: Link2 },
  { id: "reports", label: "Reports", icon: BarChart3 },
];

// ── App Shell ─────────────────────────────────────────────────────────────────

// a11y: semantic landmarks — <aside> sidebar (nav), <header> top bar, <main>.
// v1.24: header moved to a LEFT SIDEBAR; board selection moved to the TOP-RIGHT.
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
    <div className="flex min-h-screen bg-background">

      {/* ── Left sidebar: brand + vertical nav ── */}
      <aside className="w-56 flex-shrink-0 flex flex-col bg-card border-r border-border">
        {/* Brand */}
        <div className="h-14 flex items-center gap-2 px-4 border-b border-border">
          <span className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
            <LayoutDashboard className="h-4 w-4 text-primary" aria-hidden="true" />
          </span>
          <span className="text-[1.0625rem] font-bold tracking-tight text-foreground select-none">
            Loop<span className="text-primary">board</span>
          </span>
          <span
            className="ml-auto text-[0.625rem] font-semibold px-1.5 py-0.5 bg-primary/10 text-primary rounded-full whitespace-nowrap"
            aria-label="Product version"
          >
            v{__APP_VERSION__}
          </span>
        </div>

        {/* Navigation */}
        {/* a11y: <nav> landmark with aria-label (asserted by App.test) */}
        <nav aria-label="Main navigation" className="flex-1 p-3">
          <div className="flex flex-col gap-1" role="tablist" aria-label="Page tabs">
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
                  "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors text-left",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                  activeTab === id
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                <Icon className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
        </nav>
      </aside>

      {/* ── Right column: top bar + main ── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Top bar — board selection on the right */}
        <header
          role="banner"
          className="h-14 flex-shrink-0 flex items-center justify-end gap-3 px-4 sm:px-6 bg-card border-b border-border sticky top-0 z-40"
        >
          {/* Board selection (shared context) — hidden on Linking (dual-board) */}
          {activeTab !== "linking" && (
            <div className="flex items-center gap-2">
              <span className="text-[0.625rem] font-semibold text-muted-foreground uppercase tracking-wide">
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
            </div>
          )}
        </header>

        {/* a11y: main landmark wraps page content */}
        <main
          className="flex-1 max-w-[1400px] w-full mx-auto px-4 sm:px-6 py-5"
          id="main-content"
        >
          {activeTab === "dashboard" && <Dashboard {...shared} />}
          {activeTab === "planning" && <Planning {...shared} />}
          {activeTab === "leaves" && <Leaves {...shared} />}
          {activeTab === "linking" && <Linking />}
          {activeTab === "reports" && <Reports {...shared} />}
        </main>
      </div>

      {/* v1.19 (ADR-030): global floating AI assistant (FAB lower-right) */}
      <AssistantWidget />
    </div>
  );
}
