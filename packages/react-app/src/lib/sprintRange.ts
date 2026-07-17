// sprintRange.ts — pure sprint-window selection helpers for the Reports page's "Trends & KPIs"
// mode (v1.59, ADR-071). No React; no side effects; fully unit-tested.
//
// get_multi_sprint_report's sprintIds path is the only thing sent over the wire (CONTRACTS.md
// §4.29) — "last N" and "date range" selection are a CLIENT concern, resolved here from
// list_sprints data the page already has. Both helpers return sprint ids in CHRONOLOGICAL
// (oldest → newest) order, matching the tool's own chronological convention.

import type { SprintRef } from "./types";

/**
 * Take the first `n` sprints from a latest-first CLOSED list (list_sprints / useSprintList's
 * `closed` array is already sorted latest-first) and return their ids in CHRONOLOGICAL order
 * (oldest → newest).
 *
 * Fewer than `n` closed sprints → uses all of them. `n <= 0`, non-finite, or an empty/invalid
 * `closed` array → [].
 */
export function lastNClosedSprintIds(closed: SprintRef[], n: number): number[] {
  if (!Array.isArray(closed) || closed.length === 0) return [];
  if (!Number.isFinite(n) || n <= 0) return [];

  const take = closed.slice(0, Math.floor(n)); // closed is latest-first — first N = most recent N
  return [...take].reverse().map((s) => s.id); // reverse → chronological oldest → newest
}

/**
 * Sprints (active + closed only — future sprints are never included) whose `startDate` is
 * non-null and falls within `[startIso, endIso]` INCLUSIVE. Returned chronological by
 * startDate ascending (tie → id ascending, for determinism).
 *
 * Sprints with a null `startDate` are skipped (there's no date to place them by). Empty/invalid
 * inputs — no sprints, unparseable bounds, or `startIso` after `endIso` — → [].
 */
export function sprintIdsInDateRange(
  sprints: SprintRef[],
  startIso: string,
  endIso: string
): number[] {
  if (!Array.isArray(sprints) || sprints.length === 0) return [];
  if (!startIso || !endIso) return [];

  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (Number.isNaN(start) || Number.isNaN(end) || start > end) return [];

  const inRange = sprints.filter((s) => {
    if (s.state !== "active" && s.state !== "closed") return false; // never future
    if (!s.startDate) return false; // unknown date — can't place it in the range
    const t = Date.parse(s.startDate);
    if (Number.isNaN(t)) return false;
    return t >= start && t <= end;
  });

  return [...inRange]
    .sort((a, b) => {
      const at = Date.parse(a.startDate as string);
      const bt = Date.parse(b.startDate as string);
      if (at !== bt) return at - bt;
      return a.id - b.id;
    })
    .map((s) => s.id);
}

// v1.61 (ADR-073, item 175): get_multi_sprint_report's sprintIds path rejects arrays longer than
// 26 (§4.29 VALIDATION). "range" and "pick" selections are user-driven and can easily exceed
// that on a real board — cap client-side before the ids ever reach useMultiSprintReport.
export const MAX_SPRINT_WINDOW = 26;

/**
 * Cap a CHRONOLOGICAL (oldest → newest) sprint-id list at `max` entries, keeping the NEWEST ones
 * (i.e. the tail of the array — this lib's convention throughout). `capped` is true only when
 * truncation actually happened (length was over `max`), so callers can gate a "showing the
 * latest N" hint on it without an extra length check.
 */
export function capSprintWindow(
  ids: number[],
  max: number = MAX_SPRINT_WINDOW
): { ids: number[]; capped: boolean } {
  if (ids.length <= max) return { ids, capped: false };
  return { ids: ids.slice(-max), capped: true };
}

/**
 * Default "date range" window for the Trends & KPIs mode (v1.60, ADR-072): the span covering the
 * last `n` CLOSED sprints (latest-first, list_sprints convention — the same slice
 * lastNClosedSprintIds takes) through today. `start` is the min startDate among that slice (i.e.
 * the `n`th-most-recent closed sprint's startDate — the oldest one the window needs to reach back
 * to), sliced to YYYY-MM-DD for the native date input; `end` is `todayIso`, verbatim.
 *
 * Fewer than `n` closed sprints → uses all of them (same convention as lastNClosedSprintIds).
 * Returns null when `closed` is empty, `n` is not a positive finite number, or every sprint in
 * the slice has a null startDate (nothing to anchor the start on) — callers fall back to their
 * existing empty-state handling.
 */
export function defaultRangeFromClosed(
  closed: SprintRef[],
  n: number,
  todayIso: string
): { start: string; end: string } | null {
  if (!Array.isArray(closed) || closed.length === 0) return null;
  if (!Number.isFinite(n) || n <= 0) return null;

  const slice = closed.slice(0, Math.floor(n)); // closed is latest-first — first N = most recent N
  const starts = slice
    .map((s) => s.startDate)
    .filter((d): d is string => !!d && !Number.isNaN(Date.parse(d)));
  if (starts.length === 0) return null;

  const minStart = starts.reduce((min, d) => (Date.parse(d) < Date.parse(min) ? d : min));
  return { start: minStart.slice(0, 10), end: todayIso };
}
