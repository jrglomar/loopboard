// sprintPairing.ts — pure Dev-sprint pairing for the Draft Capacity Plan card
// (CONTRACTS.md §4.30 v1.68, ADR-079)
//
// Capacity is derived from leaves, and leaves are keyed by the DEV sprint
// (separate board → separate sprint ids), so the PO sprint being planned must be
// paired with a Dev sprint to read capacity from. This picks the default pairing;
// the card's native <select> lets the PO override it (persisted in the draft).
//
// No side effects; unit-tested in sprintPairing.test.ts.

import type { SprintRef } from "./types";

/** Parse a YYYY-MM-DD (or longer ISO) date-only string to UTC epoch ms, or null if invalid. */
function toUtcMs(dateOnly: string): number | null {
  const parts = dateOnly.slice(0, 10).split("-").map(Number);
  if (parts.length < 3 || parts.some((p) => Number.isNaN(p))) return null;
  return Date.UTC(parts[0]!, parts[1]! - 1, parts[2]!);
}

/**
 * Inclusive calendar-day overlap between two [start, end] date-only ranges.
 * Missing/invalid dates on either side → 0 (never throws).
 */
function overlapDays(
  aStart: string | null | undefined,
  aEnd: string | null | undefined,
  bStart: string | null | undefined,
  bEnd: string | null | undefined
): number {
  if (!aStart || !aEnd || !bStart || !bEnd) return 0;

  const aStartMs = toUtcMs(aStart);
  const aEndMs = toUtcMs(aEnd);
  const bStartMs = toUtcMs(bStart);
  const bEndMs = toUtcMs(bEnd);
  if (aStartMs === null || aEndMs === null || bStartMs === null || bEndMs === null) return 0;

  const startMs = Math.max(aStartMs, bStartMs);
  const endMs = Math.min(aEndMs, bEndMs);
  if (startMs > endMs) return 0;

  return Math.round((endMs - startMs) / 86_400_000) + 1;
}

interface Candidate {
  sprint: SprintRef;
  isFuture: boolean;
}

/**
 * Pick the default Dev sprint to pair with the PO sprint being planned, for
 * reading capacity (leaves/capacity are keyed by the Dev sprint — ADR-079).
 *
 * Rule:
 *  - candidates = [...devFuture, ...devActive] (future sprints first)
 *  - score(candidate) = overlapDays(poSprint, candidate) — inclusive calendar-day
 *    overlap of [startDate, endDate], date-only (`.slice(0, 10)`); a missing date
 *    on either side scores 0 for that candidate
 *  - pick the candidate with the max score; ties → future beats active, then the
 *    earliest startDate
 *  - if EVERY candidate scores 0: an exact sprint-name match wins; otherwise fall
 *    back to future[0] ?? active[0]
 *  - undefined when there are no candidates at all
 */
export function pairDevSprint(
  poSprint: SprintRef | undefined,
  devActive: SprintRef[],
  devFuture: SprintRef[]
): SprintRef | undefined {
  const candidates: Candidate[] = [
    ...devFuture.map((sprint) => ({ sprint, isFuture: true })),
    ...devActive.map((sprint) => ({ sprint, isFuture: false })),
  ];

  if (candidates.length === 0) return undefined;
  if (!poSprint) return devFuture[0] ?? devActive[0];

  let best: (Candidate & { score: number }) | undefined;
  for (const candidate of candidates) {
    const score = overlapDays(
      poSprint.startDate,
      poSprint.endDate,
      candidate.sprint.startDate,
      candidate.sprint.endDate
    );

    if (!best || score > best.score) {
      best = { ...candidate, score };
      continue;
    }
    if (score !== best.score) continue;

    // Tie: future beats active, then earliest startDate.
    if (candidate.isFuture && !best.isFuture) {
      best = { ...candidate, score };
    } else if (candidate.isFuture === best.isFuture) {
      const candidateStart = candidate.sprint.startDate;
      const bestStart = best.sprint.startDate;
      if (candidateStart && (!bestStart || candidateStart < bestStart)) {
        best = { ...candidate, score };
      }
    }
  }

  if (best && best.score > 0) return best.sprint;

  // All scores are 0: exact name match wins, else future[0] ?? active[0].
  const nameMatch = candidates.find((c) => c.sprint.name === poSprint.name);
  if (nameMatch) return nameMatch.sprint;

  return devFuture[0] ?? devActive[0];
}
