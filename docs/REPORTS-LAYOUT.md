# Reports Layout — UI Expert Analysis (v1.5, ADR-016)

> **v1.5 (ADR-016) supersedes v1.4.1 (ADR-013).**
> The v1.4.1 single-column rationale is preserved below for historical reference.
> The current implementation is the full-width dashboard grid described afterwards.

---

## Historical context: why v1.4.1 moved to a single column (ADR-013)

The v1.4 layout put sections in a top-level `flex-row`. This caused:

1. **Cognitive fragmentation.** Side-by-side sections break the reading narrative.
2. **Cramped at small widths.** Flex-row overflowed or collapsed without clean rhythm.
3. **Velocity and completion competed.** Neither read as the headline.
4. **Unpredictable print layout.** Wrapping width varied → inconsistent PDF output.
5. **No typographic hierarchy.** Each flex cell felt like a disconnected widget.

The v1.4.1 fix: strict vertical single-column stack in reading order (ADR-013).

---

## Why v1.5 moves to a full-width dashboard grid (ADR-016)

The v1.4.1 single column solved fragmentation but created under-use of screen width.
The `max-w-3xl` constraint left large gaps on wide monitors and made the report feel
cramped despite rich data. The product owner requested:

1. A full-width, maximally-informative Reports page.
2. A Leaves / team calendar section that needs its own column space.

### Why a dashboard grid, not just max-w removal

Removing `max-w` while keeping a vertical stack produces unreadably long lines and
wastes horizontal space on sparsely-populated sections. A **two-column grid** allows:

- **Information density:** Completion summary + Velocity sit side by side — the most
  important comparison (this sprint vs. historical trend) is visible without scrolling.
- **Parallel panels:** By-assignee + Leaves calendar sit beside each other — the two
  "who" views belong together.
- **Mobile-first collapse:** `lg:grid-cols-2` collapses to a single column at < 1024px;
  reading order is preserved; 360px stays fully usable.
- **Print fidelity:** Grid collapses to single column via `print:` classes; PDF is clean.

### How the old cognitive-fragmentation concern is mitigated

The v1.4.1 concern was valid for a cramped flex-row without visual hierarchy. The v1.5
grid is different:

- Both columns are **peers at the same tier** — not a main+sidebar asymmetry.
- Consistent `h-full` card heights and `gap-5` gap maintain visual rhythm.
- DOM reading order remains top-to-bottom, left-to-right for screen readers.

---

## v1.5 Layout specification

### Container

**Full-width (`w-full`):** no `max-w` constraint. The report spans the full page
container. Top-level spacing: `space-y-6` between major groups.

### Section grid anatomy

| # | Section | Grid placement | Rationale |
|---|---|---|---|
| 0 | Sprint picker + export bar | Full-width Card (print:hidden) | Context first; always reachable. Export bar floated right inline with sprint header. |
| 1 | Sprint header (name, dates, goal, state) | Full-width | Dominant identity; scannable in 2 seconds. |
| — | Separator | Full-width | Cleanly divides header from body. |
| 2 | Completion summary | Row 1, left col | The headline question: how much was delivered? |
| 3 | Velocity chart | Row 1, right col | Immediately contextualises completion against trend. These two answer the same question from different time perspectives — side-by-side is the right call. |
| 4 | By-assignee table | Row 2, left col | Capacity distribution follows trend context. |
| 5 | Leaves / team calendar | Row 2, right col | FRONTEND-2 SLOT — see insertion guide below. |
| 6 | Completed issues list | Row 3, left col | Drill-down: which items crossed the line. |
| 7 | Carryover list | Row 3, right col | Mirror of completed; easy comparison. |
| — | Separator | Full-width | Divides data body from AI narrative. |
| 8 | AI executive summary | Full-width | Synthesis sits last; data always visible when AI is off. |

### Responsive behavior

- **>= lg (1024 px):** 2-equal-column grid rows as above.
- **< lg (< 1024 px):** all rows collapse to single column; DOM reading order preserved.
- **360 px minimum:** inner tables and charts use `overflow-x-auto`; no page-level scroll.
- **Print / PDF:** `print:` classes collapse grid to single column; picker + export are hidden.

### Typography and spacing (inherited from v1.3/v1.4.1)

- Sprint title: `text-2xl font-semibold` — dominant, scannable.
- Section heading: `text-base font-semibold` + lucide icon.
- Stat tile value: `text-lg`/`text-xl font-bold tabular-nums`.
- Meta / caption: `text-xs text-muted-foreground`.
- Cards: `shadow-sm rounded-lg`. Grid gap: `gap-5`. Outer sections: `space-y-6`.
- All point values via `formatPoints(n)` — at most 2 decimals, trailing zeros trimmed.

### Story-points focus (unchanged from ADR-013)

- No "issues done / total" metric tile.
- Carryover as points (committed − completed), not issue counts.
- Blocked is a risk chip, not a metric.
- By-assignee: Name / Done pts / Total pts (+ Leaves column when Frontend 2 adds it).

---

## Frontend 2 insertion guide (Leaves / capacity, v1.5 ADR-016)

### 1. Leaves section card — Row 2, right column

**File:** `packages/react-app/src/pages/Reports.tsx`, inside `SprintReportView`.

Find this comment block in the Row 2 grid:
```tsx
{/* (5) FRONTEND-2 SLOT: Leaves / team calendar */}
{/* Replace this placeholder with <LeavesCalendarCard ... /> */}
<div className="hidden lg:block" aria-hidden="true">
  {/* Frontend 2 will render the Leaves section here */}
</div>
```
Replace the placeholder `<div>` with `<LeavesCalendarCard>`. The component needs:
- `sprintId: number` (from `report.sprint.id`)
- `byAssignee: SprintReport["byAssignee"]` (to derive assignee names)
- `sprint: SprintRef` (to derive `startDate`/`endDate` for working-day grid)

Emit a `leaves?: Record<string, number>` (name → days off) up to `SprintReportView`
so `ByAssigneeTable` can receive it.

### 2. Leaves column in ByAssigneeTable

**File:** `packages/react-app/src/pages/Reports.tsx`, `ByAssigneeTable` component.

Insertion comment in the `<thead>`:
```tsx
{/* FRONTEND-2: add <th className="text-right pb-2 pl-3">Leaves</th> here */}
```
Insertion comment in each `<tr>` in `<tbody>`:
```tsx
{/* FRONTEND-2: add <td className="py-2 pl-3 text-right tabular-nums">{leaves?.[row.name] ?? 0} days</td> here */}
```
Add `leaves?: Record<string, number>` to `ByAssigneeTableProps` and pass it from
`SprintReportView`.

### 3. useLeaves hook

**File:** `packages/react-app/src/hooks/useJira.ts`

Add `useLeaves(sprintId: number | null)` following the same `useMCP` + `useEffect`
pattern as `useSprintReport`. Calls `get_leaves` tool; see CONTRACTS.md §4.14.

### 4. Shared files this PR touched (inform Frontend 2)

| File | What changed |
|---|---|
| `src/lib/types.ts` | Added `storyPointsCodeReview: number` to `GetActiveSprintOutput.totals` |
| `src/hooks/useJira.ts` | `useVelocity` signature: now accepts optional `beforeSprintId?: number \| null` |
| `src/pages/Reports.tsx` | Full rewrite — full-width grid; velocity receives `selectedSprintId`; insertion points marked |
| `src/lib/sprintMetrics.ts` | `computeProgress` accepts optional `storyPointsCodeReview` and includes it in completed % |
| `src/components/SprintBoard.tsx` | Progress label uses `storyPointsDone + storyPointsCodeReview` |
