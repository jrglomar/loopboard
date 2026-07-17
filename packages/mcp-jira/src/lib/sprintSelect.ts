/**
 * Pure sprint selection logic per CONTRACTS.md §4.3 / ADR-007 / ADR-011.
 *
 * v1.4: fetches active+future, sorts each group separately, selects from
 * active∪future with correct error messages.
 */

import { UpstreamError } from "./errors.js";

export interface SprintStub {
  id: number;
  name: string;
  state: string;
  startDate: string | null;
  endDate: string | null;
  goal: string | null;
}

/**
 * Sort an array of sprint stubs latest-first (descending startDate):
 *  - descending startDate (ISO string compare is sufficient for ISO 8601);
 *  - null startDate sorts last;
 *  - ties broken by descending id.
 *
 * Returns a new array (does not mutate input).
 */
export function sortSprintsLatestFirst<T extends SprintStub>(sprints: T[]): T[] {
  return [...sprints].sort((a, b) => {
    const aDate = a.startDate;
    const bDate = b.startDate;

    // null startDate sorts last
    if (aDate === null && bDate === null) {
      return b.id - a.id; // descending id tiebreak
    }
    if (aDate === null) return 1;  // a is null → a goes after b
    if (bDate === null) return -1; // b is null → a goes before b

    // descending startDate ISO compare
    if (aDate > bDate) return -1;
    if (aDate < bDate) return 1;

    // tie → descending id
    return b.id - a.id;
  });
}

/**
 * Sort an array of sprint stubs earliest-first (ascending startDate):
 *  - ascending startDate (ISO string compare);
 *  - null startDate sorts last;
 *  - ties broken by ascending id.
 *
 * Used for future sprints so the *next* sprint (soonest startDate) comes first.
 * Returns a new array (does not mutate input).
 */
export function sortSprintsEarliestFirst<T extends SprintStub>(sprints: T[]): T[] {
  return [...sprints].sort((a, b) => {
    const aDate = a.startDate;
    const bDate = b.startDate;

    // null startDate sorts last
    if (aDate === null && bDate === null) {
      return a.id - b.id; // ascending id tiebreak
    }
    if (aDate === null) return 1;  // a is null → a goes after b
    if (bDate === null) return -1; // b is null → a goes before b

    // ascending startDate ISO compare
    if (aDate < bDate) return -1;
    if (aDate > bDate) return 1;

    // tie → ascending id
    return a.id - b.id;
  });
}

/**
 * Sort an array of closed (or closed+active) sprint stubs latest-first:
 *  - descending `completeDate ?? endDate` (ISO string compare);
 *  - null date (both completeDate and endDate null) sorts last;
 *  - ties broken by descending id.
 *
 * v1.59 (ADR-071): extracted from the identical inline sort previously duplicated
 * in getVelocity.ts and listSprints.ts. Active sprints have no completeDate, so
 * they sort by their planned endDate — this is what lets get_velocity's
 * includeActive pool active sprints alongside closed ones in one latest-first list.
 *
 * Returns a new array (does not mutate input).
 */
export function sortClosedSprintsLatestFirst<
  T extends { id: number; endDate: string | null; completeDate: string | null }
>(sprints: T[]): T[] {
  return [...sprints].sort((a, b) => {
    const aDate = a.completeDate ?? a.endDate;
    const bDate = b.completeDate ?? b.endDate;
    if (aDate === null && bDate === null) return b.id - a.id;
    if (aDate === null) return 1;
    if (bDate === null) return -1;
    if (aDate > bDate) return -1;
    if (aDate < bDate) return 1;
    return b.id - a.id;
  });
}

/**
 * Select the target sprint from active∪future lists (v1.4).
 *
 * @param activeSorted   Sorted active sprints (latest-first).
 * @param futureSorted   Sorted future sprints (earliest-first).
 * @param boardId        Board id — used in error messages only.
 * @param sprintId       Optional explicit sprint id to select.
 * @returns              The selected sprint.
 * @throws UpstreamError when both lists are empty, or when an explicit sprintId
 *                       is not found in either active or future.
 */
export function selectSprintFromActiveFuture<T extends SprintStub>(
  activeSorted: T[],
  futureSorted: T[],
  boardId: number,
  sprintId?: number
): T {
  // Both empty → error
  if (activeSorted.length === 0 && futureSorted.length === 0) {
    throw new UpstreamError(
      `No active or future sprint found for board ${boardId}`,
      404
    );
  }

  if (sprintId !== undefined) {
    // Search active first, then future
    const found =
      activeSorted.find((s) => s.id === sprintId) ??
      futureSorted.find((s) => s.id === sprintId);
    if (!found) {
      throw new UpstreamError(
        `Sprint ${sprintId} is not an active or future sprint on board ${boardId}`,
        404
      );
    }
    return found;
  }

  // Default: latest active; fall back to first future
  if (activeSorted.length > 0) {
    return activeSorted[0]!;
  }
  return futureSorted[0]!;
}

/**
 * Select the target sprint from a sorted list (legacy — active-only).
 * Kept for backward compat in getDailyHuddle which also uses active+future now.
 *
 * @param sorted       Already sorted (latest-first) list of active sprints.
 * @param boardId      Board id — used in error messages only.
 * @param sprintId     Optional explicit sprint id to select.
 * @returns            The selected sprint.
 * @throws UpstreamError when the list is empty or when an explicit sprintId is not found.
 * @deprecated Prefer selectSprintFromActiveFuture for v1.4 callers.
 */
export function selectSprint<T extends SprintStub>(
  sorted: T[],
  boardId: number,
  sprintId?: number
): T {
  if (sorted.length === 0) {
    throw new UpstreamError(
      `No active sprint found for board ${boardId}`,
      404
    );
  }

  if (sprintId !== undefined) {
    const found = sorted.find((s) => s.id === sprintId);
    if (!found) {
      throw new UpstreamError(
        `Sprint ${sprintId} is not an active sprint on board ${boardId}`,
        404
      );
    }
    return found;
  }

  // Default: first in sorted list (latest-started)
  return sorted[0]!;
}
