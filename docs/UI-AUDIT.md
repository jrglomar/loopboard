# UI Audit — InvokeBoard Dashboard
## Phase 2 Modernization (ADR-009)
### Date: 2026-06-12

---

## Methodology

Every screen was read against the Phase 1 output. Issues are grouped by screen/component,
prioritized P1 (clarity/usability blocker), P2 (visual quality), P3 (polish/nice-to-have).
Design principles applied: minimal & clean, consistent 4/8-point spacing scale, clear
visual hierarchy, flat/soft-UI over heavy shadows, coherent accent+status palette, modern
affordances, responsive ≥ 360px.

---

## App Shell (App.tsx + styles.css layout classes)

| # | Priority | Issue | Why it matters | Specific fix |
|---|----------|-------|----------------|--------------|
| 1 | **P1** | `.app`, `.app-header`, `.app-nav`, `.app-main`, `.app-header__inner`, `.app-nav__inner`, `.tab-btn` are hand-rolled CSS in `styles.css` — not Tailwind utilities | Phase 1 left layout classes unmigrated; `styles.css` is still imported alongside `globals.css`, creating two competing style systems | Migrate all App shell classes to Tailwind utilities inline on the JSX elements; retire the corresponding rules in `styles.css` |
| 2 | **P1** | `.app-header__sprint-ctx` "Phase 2 Dashboard" badge is a static string — visually prominent but conveys no real sprint state | Users expect the context pill to reflect real data; a static label erodes trust | Replace with a simpler inline badge at lower visual weight; update copy to "v1.2" product version pill |
| 3 | **P2** | Header height is 56px via CSS class; nav is a second `bg-card` bar directly below — two white bands feel heavy | Redundant chrome consumes ~96px before any content | Collapse both into a single `sticky` bar: logo left, nav tabs right. Reduces perceived overhead significantly |
| 4 | **P2** | Tab nav uses `border-b-2` indicator but the active indicator color relies on `border-b-primary` which renders well yet the hover/inactive states are visually flat | Low affordance for which tab is clickable | Strengthen hover: add `hover:bg-muted/50` background on inactive tabs; ensure active tab has unmistakable `border-b-[3px] border-primary` |
| 5 | **P3** | `styles.css` `:root` block duplicates every custom property already defined in `globals.css` (both define `--bg`, `--surface`, `--border`, `--shadow-sm`, status colors, etc.) | Redundant definitions increase maintenance cost; globals.css values are in HSL (shadcn-compatible) while styles.css duplicates in hex; last-one-wins cascade risk | Remove the `:root` block and all utility classes from `styles.css`; consolidate onto `globals.css` tokens; keep only rules that have NO Tailwind equivalent |

---

## Dashboard Layout (Dashboard.tsx)

| # | Priority | Issue | Why it matters | Specific fix |
|---|----------|-------|----------------|--------------|
| 6 | **P1** | `.dashboard` grid (1fr + 380px sidebar) is defined in `styles.css` — not a Tailwind class | Phase 1 gap; layout class not migrated | Replace with `grid grid-cols-1 lg:grid-cols-[1fr_380px]` Tailwind utilities directly on the `<div>` |
| 7 | **P2** | Sidebar fixed at 380px means at 1024–1200px viewports the board gets very little space and 4 columns are each only ~150px wide | Usability crunch at common laptop widths | Change sidebar to `360px` minimum with `min-width-0` on board column; board area uses `overflow-x-auto` for the column grid on narrower widths |
| 8 | **P3** | No visual grouping hint between HuddleDigest and ChatPanel in the sidebar — they feel like one blob | Slight visual noise | Add `gap-4` (already in CSS) between sidebar sections; no extra border needed — whitespace is sufficient |

---

## SprintBoard (SprintBoard.tsx)

| # | Priority | Issue | Why it matters | Specific fix |
|---|----------|-------|----------------|--------------|
| 9 | **P1** | `.sprint-columns` 4-column grid is defined in `styles.css` with breakpoints — still in use | Still a CSS-class layout, not Tailwind | Migrate to `grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3` with `overflow-x-auto` wrapper at mobile and snap scrolling at ≤480px |
| 10 | **P1** | Sprint header mixes multiple `className` + legacy CSS class names (`.sprint-header`, `.sprint-header__top`, `.sprint-header__filter-row`) alongside Tailwind utilities | Inconsistent: some elements are Tailwind, some are still CSS-class driven | Remove all remaining CSS class names from the sprint header; replace with Tailwind utilities inline |
| 11 | **P1** | Story-points display uses text checkmark `✓ 4 pts done` inline text — low visual hierarchy; critical sprint progress not prominent | Users scan sprint progress first; it needs to stand out | Wrap done-pts and total-pts in styled pill badges using Tailwind; add `text-emerald-700 font-semibold` for done, `text-muted-foreground` for total |
| 12 | **P2** | `.sprint-header__meta` date row uses `→` arrow character and lists `state` (word "active") with no visual distinction | "active" text is semantically redundant (we're on the sprint board) and the `→` is visually flat | Remove state word; format dates as `Jun 1 – Jun 14` using `toLocaleDateString`; use `·` bullet separator |
| 13 | **P2** | Sprint column background uses `bg-muted/40` — very subtle, columns can blend into each other at a glance | Column distinction is critical for a kanban board | Increase to `bg-muted/60` and add column-specific top-border: 2px slate/blue/violet/green for todo/inprogress/codereview/done |
| 14 | **P2** | Issue cards in `.sprint-column` use `mb-2` margin (bottom margin on cards within `<ul>`) rather than gap on the list — minor but creates inconsistent spacing | Prefer flex/grid gap over margin on list items | Use `flex flex-col gap-2` on the `<ul>` element, remove `mb-2` from card |
| 15 | **P3** | Blocked badge uses `⚠` unicode — not announced consistently by screen readers | a11y: prefer text-only badge | Keep `⚠` but add `aria-hidden` and rely on `role="status"` + text "Blocked" — already done in markup; ensure contrast is ≥ 4.5:1 |
| 16 | **P3** | "No issues" empty column text has no icon or visual affordance | Minor empty state polish | Add a small `·` or neutral icon in muted text |

---

## HuddleDigest (HuddleDigest.tsx)

| # | Priority | Issue | Why it matters | Specific fix |
|---|----------|-------|----------------|--------------|
| 17 | **P1** | `.huddle-digest` and `.huddle-section` class names still reference `styles.css` rules | Leftover CSS class names from before Phase 1 — rules exist in `styles.css` | Retire `.huddle-digest`, `.huddle-section`, `.huddle-section__title`, `.huddle-item*` CSS rules; ensure all styling is Tailwind |
| 18 | **P1** | Copy button is the primary action in HuddleDigest but at `size="sm"` it reads as secondary; positioned top-right in the card header | Primary action should be visually prominent | Use `size="default"` button; position it more prominently — right-aligned in the header row with clear CTA styling |
| 19 | **P2** | `summaryText` box uses `bg-primary/10 rounded-sm` — looks like a faded info box; loses visual rhythm with the rest of the card | Could be mistaken for a disabled or error state | Switch to `bg-muted rounded-md` with a `border-l-4 border-primary` left accent — clearly "summary" pattern |
| 20 | **P2** | Each huddle section has a hard `mb-4` but no visual top separator — the sections flow into each other at scroll | Hard to scan individual sections at a glance | Keep `Separator` between sections; but remove the inline `className="huddle-section mb-4"` CSS class pattern and use Tailwind `space-y-4` on the container |
| 21 | **P3** | `Generated {date}` footer is plain `text-xs text-muted-foreground` — indistinguishable from other muted text | Useful timestamp but lost in noise | Prepend a clock icon or the word "Updated:" to distinguish from item text |

---

## ChatPanel (ChatPanel.tsx)

| # | Priority | Issue | Why it matters | Specific fix |
|---|----------|-------|----------------|--------------|
| 22 | **P1** | `.chat-panel` class name still used in `cn()` alongside Tailwind utilities — CSS rule defines `height: 480px` via class. The actual height is set inline as `style={{ height: "480px" }}` too (doubly defined) | Double definition; legacy class lingers | Remove `.chat-panel` CSS class reference; keep `style={{ height: "480px" }}` or convert to `h-[480px]` Tailwind |
| 23 | **P1** | `.ticket-link` CSS class is still used in `TicketPairCard` inside ChatPanel — styles from `styles.css` | Legacy class not migrated | Replace `.ticket-link` with Tailwind: `inline-flex items-center gap-1.5 px-3 py-1.5 bg-card border border-border rounded font-mono font-bold text-primary hover:text-primary/80 hover:shadow-sm transition-shadow text-[0.9375rem]` |
| 24 | **P2** | Initial assistant welcome message uses backtick code formatting in plain text string (`type \`help\``) — backticks render literally | Poor visual formatting in the welcome message | Use JSX rendering for the welcome message with `<code>` inline elements, or a simpler plain-English string |
| 25 | **P2** | `<code>` tag inside the hint area (`type help`) is small and relies on `bg-muted` background — barely readable at muted colors | Low contrast in tiny code chip | Increase the code chip contrast: `bg-muted text-foreground border border-border` |
| 26 | **P3** | Send button is `size="sm"` — visually under-powered relative to the input it pairs with | Send is the primary action in a chat panel | Use `size="default"` or at minimum ensure button height matches textarea single-row height |

---

## TicketGen (TicketGen.tsx)

| # | Priority | Issue | Why it matters | Specific fix |
|---|----------|-------|----------------|--------------|
| 27 | **P1** | `.ticket-gen` CSS class (max-width: 1100px) and `.draft-preview` grid (2-col) still reference `styles.css` | Layout class not migrated | Replace with `max-w-5xl` on the outer div and `grid grid-cols-1 md:grid-cols-2 gap-5` on the draft preview wrapper |
| 28 | **P1** | `.ticket-link` CSS class in success panel — same issue as ChatPanel #23 | Legacy class | Same Tailwind replacement as #23 |
| 29 | **P2** | Success panel uses `bg-green-50 border-green-200` directly on a `<Card>` — breaks the token system; green values are not from the global status tokens | Inconsistent token usage; harder to theme | Use `bg-[hsl(var(--status-done-bg))]` or define a `success` variant; simpler: use the existing `--success-bg` / `--success-border` CSS variables directly via Tailwind arbitrary values `bg-[var(--success-bg)] border-[var(--success-border)]` |
| 30 | **P2** | AI fallback banner uses hard-coded `bg-amber-50 border-amber-200 text-amber-900` — same token inconsistency | Should use `--warning-*` tokens | Replace with `bg-[var(--warning-bg)] border-[var(--warning-border)] text-[var(--warning-text)]` |
| 31 | **P2** | In AI mode, `ChatThread` + input card + draft cards stack vertically without clear visual separation between AI conversation and the draft editing zone | Workflow stages blur into each other | Add a subtle `<Separator />` or a section label ("Draft Preview") between the AI thread/input and the draft cards |
| 32 | **P3** | Story-points input in AI mode is labeled "Story pts" (abbreviated) — inconsistent with fallback form which uses "Story points" | Inconsistent label copy | Standardize to "Story points" in both modes |

---

## Reports (Reports.tsx)

| # | Priority | Issue | Why it matters | Specific fix |
|---|----------|-------|----------------|--------------|
| 33 | **P2** | `.reports-stub` CSS class (max-width: 640px) in `styles.css` | Legacy class | Replace with `max-w-2xl` Tailwind on outer div; already has `max-w-[640px]` partially in JSX but the CSS class also defines it |
| 34 | **P3** | Phase badge uses inline Tailwind `bg-amber-100 text-amber-800 border-amber-300` — same token inconsistency pattern | Use warning tokens | Replace with `--warning-*` token values |

---

## styles.css Retirement Plan

After all the above fixes, the following `styles.css` rules will be fully retired (all consumed by Tailwind utilities or globals.css):

**Retire entirely:**
- `:root` block (exact duplicate of `globals.css` tokens)
- Reset block (`*, body, html, focus-visible, a` rules) — `globals.css` already handles all of these
- `.app`, `.app-header`, `.app-header__inner`, `.app-header__logo`, `.app-header__sprint-ctx`, `.app-header__logo span`
- `.app-nav`, `.app-nav__inner`, `.tab-btn`, `.tab-btn[aria-pressed]`
- `.app-main`
- `.card`, `.card--padded`, `.card__title`
- `@keyframes shimmer`, `.skeleton`, `.skeleton--text`, `.skeleton--block` (shadcn `Skeleton` covers this)
- `.dashboard`, `.dashboard__board`, `.dashboard__huddle`, `.dashboard__chat` + breakpoints
- `.sprint-board`, `.sprint-header*`, `.sprint-columns` + breakpoints, `.sprint-column*`
- `.issue-card*`, `.badge--blocked`
- `.huddle-digest`, `.huddle-section*`, `.huddle-item*`
- `.chat-panel*`, `.chat-message*`, `.chat-result-card*`, `.chat-input*`, `.chat-send-btn*`
- `.ticket-gen*`, `.field-group*`, `.field-label*`, `.field-input*`, `.btn*`, `.draft-preview*`, `.draft-pane*`
- `.success-panel*`, `.ticket-link`
- `.reports-stub*`, `.phase-badge`
- `.state-error*`, `.state-empty*`
- `.sprint-header__top`, `.sprint-selector*`, `.sprint-header__filter-row`, `.assignee-filter*`, `.sprint-filter-count`
- `.huddle-section__title--codereview`, `.btn--use-ai*`, `.ai-badge*`, `.ai-fallback-banner*`
- `.ticketgen-thread`, `.ticketgen-bubble*`, `.ticketgen-input-area*`, `.ticketgen-input-row*`, `.ticketgen-ai-input*`
- `.sr-only`, `.text-muted`, `.text-sm`, `.text-xs`, `.mt-*`, `.mb-*`, `.flex`, `.flex-wrap`, `.gap-*`, `.items-center` (all Tailwind utilities)
- `.chat-message__bubble pre`, `.chat-message__bubble code`

**Keep (no Tailwind equivalent):**  
- None — all remaining rules have been fully converted.

After retirement, `styles.css` becomes empty and the import in `main.tsx` can be removed.

---

## Design Token System (Phase 2 standard)

**Spacing scale:** Tailwind 4pt grid — `gap-3` (12px), `gap-4` (16px), `gap-5` (20px); `p-3`/`p-4` for cards; `px-6` for page containers. No hand-rolled pixel values.

**Typography:** `text-xs` (12px), `text-sm` (14px), `text-base` (16px), `text-lg` (18px), `text-2xl` (24px) for headings; `font-semibold` for UI labels, `font-bold` for headings; `font-mono` for keys/code.

**Colors:** All colors via shadcn CSS variables (`text-foreground`, `text-muted-foreground`, `bg-card`, `bg-muted`, `text-primary`, `text-destructive`) or the retained `--status-*`/`--warning-*`/`--success-*` tokens. No raw hex or arbitrary Tailwind colors except for the violet code-review accent (`text-violet-700`, `border-violet-300`) and status green (`text-emerald-700`, `text-green-700`) which map to the original palette.

**Borders:** `border border-border` throughout; `border-l-4` for accent/blocked callouts. No heavy drop shadows — `shadow-sm` maximum on card surfaces.

**Focus:** `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1` on interactive elements; ensured by shadcn component defaults.

---

## v1.3 Applied (ADR-010, 2026-06-12)

Two-specialist (UI/UX + Scrum Master) review applied as a single pass against §6.1.

**Token system:** semantic `success`/`warning`/`error`/`info` each with `-bg`/`-foreground`/`-border` promoted to named Tailwind extensions; status token group (`status-todo/inprogress/codereview/done/blocked`) with tint variants; `.dark` variable block added (no toggle UI yet). Ad-hoc `green-50`/`amber-50` literals replaced.

**SprintBoard header (3 zones):** identity (sprint name text-2xl font-semibold + date range with Calendar icon + goal with Target icon) · progress (points bar + issues count + timeline elapsed bar + pace chip) · controls (sprint + assignee selects label-above h-9, My Issues toggle). Column headers are now filled tinted bands using status token group with lucide icon per column.

**Sprint progress + pace:** `computeProgress`, `computeTimeline`, `computePace` pure functions in `src/lib/sprintMetrics.ts` (27 unit tests). "No estimates" path shows text instead of 0% bar. Pace chip (On track/Behind/Ahead) uses success/warning/info semantic tokens; omitted when null.

**Blocker banner:** `Alert` above columns when `totals.blocked > 0`; up to 5 key links; "Show blocked" toggle (aria-pressed) composes with assignee filter. Hidden when 0 blocked.

**My Issues quick filter:** `localStorage` key `invokeboard.me`; first click opens inline picker; remembered name applied with aria-pressed toggle. Initials avatar chips added to issue cards and filter.

**Huddle By-person toggle:** `regroupByPerson` + `buildByPersonClipboardText` in `src/lib/huddleRegroup.ts` (21 unit tests). summaryText and By-status clipboard text unchanged.

**Reports:** Velocity + Burndown placeholder cards added — clearly disabled (aria-disabled, no numbers). Phase-3 label explicit.

**Test counts:** 202 passing (up from 161 before this round): +27 sprintMetrics, +21 huddleRegroup, +10 SprintBoard v1.3 cases, +7 HuddleDigest v1.3 cases. No behavioral assertions weakened.
