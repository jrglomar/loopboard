// Guide (v1.49, ADR-060) — an in-app user guide. Reached from the header "Guide" button rather
// than a tab, to keep the tab bar uncluttered (per the v1.48 UI review). Static content that
// mirrors docs/USER-GUIDE.md, written for reading inside the app. A sticky table of contents on
// wide screens; a plain anchored list on mobile.

import type { ReactNode } from "react";
import {
  BookOpen, PlayCircle, LayoutDashboard, CalendarRange, CalendarDays, Link2, BarChart3,
  Sparkles, Plug, ShieldCheck, MessageCircle, HelpCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

type Section = { id: string; title: string; icon: typeof BookOpen; body: ReactNode };

// A term the reader recognises in the UI (bold), used consistently across sections.
function T({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-foreground">{children}</strong>;
}

const SECTIONS: Section[] = [
  {
    id: "getting-started",
    title: "Getting started",
    icon: PlayCircle,
    body: (
      <>
        <p>Three steps and you're in:</p>
        <ol className="list-decimal pl-5 space-y-1.5 mt-2">
          <li><T>Sign in</T> (or create an account) on the login screen.</li>
          <li>
            Open <T>Connections</T> and add your own <T>Jira</T> and <T>GitHub</T> tokens — and an{" "}
            <T>AI</T> token if you want the AI features. The app unlocks the moment Jira and GitHub are connected.
          </li>
          <li>
            Pick your <T>board</T> (PO or Dev) and <T>sprint</T> from the top-right. That choice is shared
            across the Huddle, Planning, Reports and Task Helper.
          </li>
        </ol>
        <p className="mt-3">
          If an admin set you up on <T>shared credentials</T>, you'll see a <T>Read-only</T> badge in the
          header: you can view everything but not change Jira. Ask an admin to enable writes for you, or
          connect your own Jira token on Connections to act as yourself.
        </p>
      </>
    ),
  },
  {
    id: "huddle",
    title: "Huddle — your daily standup",
    icon: LayoutDashboard,
    body: (
      <>
        <p>The run-the-standup home screen.</p>
        <ul className="list-disc pl-5 space-y-1.5 mt-2">
          <li><T>Sprint board</T> — the sprint's issues in <T>To Do · In Progress · Code Review · Done</T>, with points, assignee and a “has-PR” badge; filter by assignee.</li>
          <li><T>Daily huddle digest</T> — a copy-pastable summary, viewable by status or <T>by person</T> for walk-the-board standups.</li>
          <li><T>Sidebar cards</T> (each collapses via the chevron; your choices are remembered): <T>Needs attention</T> (stale, unassigned, PRs awaiting review), <T>Meeting goal</T>, <T>Meeting notes</T> (rich text), <T>Impediments</T>, <T>On leave</T>, and <T>Code review</T> (linked PRs + approval status).</li>
          <li><T>Fly-in tracker</T> across the Dev and PO boards, plus auto-refresh with a “last updated” stamp.</li>
        </ul>
      </>
    ),
  },
  {
    id: "planning",
    title: "Planning — grooming & sprint prep",
    icon: CalendarRange,
    body: (
      <ul className="list-disc pl-5 space-y-1.5">
        <li><T>Create a sprint</T> and target new tickets into it.</li>
        <li><T>Ticket generator</T> — draft PO stories and Dev tasks (AI-assisted when AI is on, deterministic templates otherwise), created straight into the chosen board.</li>
        <li><T>Leaves &amp; capacity</T> — plot each teammate's leave by type; the plotter shows each developer's remaining capacity.</li>
        <li><T>Assignment list</T> — assign the sprint's tickets (bulk-assign supported), edit story points inline, and change status or move a ticket between sprints.</li>
        <li><T>Team roster</T> — curate the people Loopboard plans around.</li>
      </ul>
    ),
  },
  {
    id: "offset",
    title: "Offset Tracker — leaves & offset wallet",
    icon: CalendarDays,
    body: (
      <ul className="list-disc pl-5 space-y-1.5">
        <li><T>Typed leaves</T> — Vacation, Emergency, Holiday and <T>Offset</T> days per person.</li>
        <li><T>Offset wallet</T> — earned offset banks automatically each sprint; spending auto-deducts from Offset leaves. See each developer's balance and a full <T>history</T> of earns and spends.</li>
      </ul>
    ),
  },
  {
    id: "linking",
    title: "Linking — turn PO stories into Dev tasks",
    icon: Link2,
    body: (
      <ul className="list-disc pl-5 space-y-1.5">
        <li>Select PO stories and <T>bulk-create linked Dev tasks</T>, with an AI plan drafted from each story's description.</li>
        <li><T>Point-driven breakdown</T> — a story's points auto-split into one or two Dev tasks (e.g. 4 → 2 + 2), each with its own points and assignee.</li>
        <li>Links are created so the <T>PO story “depends on” its Dev task(s)</T>.</li>
      </ul>
    ),
  },
  {
    id: "reports",
    title: "Reports — sprint review & metrics",
    icon: BarChart3,
    body: (
      <ul className="list-disc pl-5 space-y-1.5">
        <li><T>Per-sprint report</T> — committed vs. completed points, completion rate and a by-assignee table (code-review-complete counts as done, per your Definition of Done).</li>
        <li><T>Velocity</T> — the average of recent closed sprints, capacity-adjusted for leave.</li>
        <li><T>Retrospective</T> — a persisted retro that also pre-fills the full-report export.</li>
        <li><T>Export</T> — Copy (Markdown), a printable <T>PDF</T>, or a styled <T>Excel</T> workbook with a per-member table (points + leaves by type + offset balance).</li>
        <li><T>AI executive summary</T> — an on-demand narrative of the sprint (when AI is on).</li>
      </ul>
    ),
  },
  {
    id: "task-helper",
    title: "Task Helper — ticket → prompt, plus your journal",
    icon: Sparkles,
    body: (
      <>
        <p><T>Turn one of your tickets into a coding-agent prompt:</T></p>
        <ol className="list-decimal pl-5 space-y-1.5 mt-2">
          <li>Pick a ticket from your selected sprint (optionally add repo / stack context).</li>
          <li>Click <T>Refine &amp; build prompt</T> — the AI rewrites the ticket into a crisp spec and produces a ready-to-paste prompt for Copilot, Claude Code or Cursor. Nothing is written back to Jira.</li>
        </ol>
        <p className="mt-3">
          The same tab keeps your <T>notes &amp; to-dos</T> for the sprint — type a note and press Enter to
          log it, and tick off a checklist you can tie to your tickets. These are <T>private to you</T>.
        </p>
      </>
    ),
  },
  {
    id: "connections",
    title: "Connections — your accounts",
    icon: Plug,
    body: (
      <p>
        Connect and disconnect your own <T>Jira</T>, <T>GitHub</T> and <T>AI</T> tokens here. Tokens are
        encrypted at rest and are <T>never shown back to you</T> — only a masked “…last4” hint. Your AI
        token is what powers the Task Helper and the assistant.
      </p>
    ),
  },
  {
    id: "admin",
    title: "Admin — team management",
    icon: ShieldCheck,
    body: (
      <>
        <p className="text-xs font-medium text-muted-foreground mb-2">Visible to admins only.</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li><T>Users</T> — create accounts, reset passwords, promote/demote, disable, or delete.</li>
          <li><T>Shared credentials</T> — onboard a viewer who has no tokens of their own by pointing them at another user's Jira/GitHub/AI. They're read-only against Jira unless you allow writes.</li>
          <li><T>Board &amp; env config</T> — set defaults globally or per-user, and save reusable <T>templates</T> you can apply to any user or to the global defaults.</li>
        </ul>
      </>
    ),
  },
  {
    id: "assistant",
    title: "AI assistant — the floating chat",
    icon: MessageCircle,
    body: (
      <>
        <p>The button in the lower-right is on every page (when AI is connected). Use it to:</p>
        <ul className="list-disc pl-5 space-y-1.5 mt-2">
          <li><T>Ask</T> about the current sprint — “what's in code review?”, “who owns VRDB-1234?”, “any impediments today?”</li>
          <li><T>Propose changes</T> — update points, move a ticket, set a sprint goal, file leave — each shown for <T>confirmation before it's applied</T>. Nothing changes without your OK.</li>
        </ul>
      </>
    ),
  },
  {
    id: "tips",
    title: "Tips & troubleshooting",
    icon: HelpCircle,
    body: (
      <ul className="list-disc pl-5 space-y-1.5">
        <li><T>Board switcher</T> (top-right) flips PO ⇄ Dev context; Linking and Task Helper work across both.</li>
        <li>Every Huddle sidebar card collapses via the chevron in its header — handy on long sprints.</li>
        <li><T>“Bridge is offline”</T> — a page can't reach the Jira/GitHub server. Ask whoever runs Loopboard to start the bridges.</li>
        <li><T>A report looks empty?</T> Check the board is right and the sprint has issues assigned to your rostered team.</li>
        <li><T>Security</T> — tokens live only in the server config or the encrypted per-user vault; they're never logged or sent to your browser.</li>
      </ul>
    ),
  },
];

export function Guide() {
  return (
    <div className="max-w-5xl mx-auto">
      <header className="mb-6">
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-primary" aria-hidden="true" /> Using Loopboard
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Loopboard turns your Jira sprint into a live board, a daily-huddle digest, planning and
          reporting tools, leave tracking, and an AI helper. Here's what each part does.
        </p>
      </header>

      <div className="lg:grid lg:grid-cols-[210px_minmax(0,1fr)] lg:gap-8">
        {/* Table of contents */}
        <nav aria-label="Guide contents" className="mb-5 lg:mb-0">
          <div className="lg:sticky lg:top-16">
            <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              On this page
            </p>
            <ul className="space-y-0.5">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[0.8125rem] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <s.icon className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                    <span className="truncate">{s.title}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </nav>

        {/* Sections */}
        <div className="space-y-4 min-w-0">
          {SECTIONS.map((s) => (
            <section key={s.id} id={s.id} className="scroll-mt-16">
              <Card className="shadow-sm">
                <CardHeader className="px-4 pt-4 pb-2">
                  <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                    <span className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <s.icon className="h-4 w-4 text-primary" aria-hidden="true" />
                    </span>
                    {s.title}
                  </h2>
                </CardHeader>
                <CardContent className="px-4 pb-4 text-sm text-muted-foreground leading-relaxed">
                  {s.body}
                </CardContent>
              </Card>
            </section>
          ))}

          <p className="text-xs text-muted-foreground pt-1">
            Setting up Loopboard for a team (connecting Jira, enabling AI, deploying) is covered in the
            project's <code className="font-mono">docs/</code> folder — see <code className="font-mono">USER-GUIDE.md</code> and <code className="font-mono">SETUP.md</code>.
          </p>
        </div>
      </div>
    </div>
  );
}
