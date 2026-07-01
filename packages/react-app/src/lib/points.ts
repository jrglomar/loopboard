// Point-scale breakdown (v1.36, ADR-046) — split a PO story's points into up to
// two Dev-task estimates drawn from the allowed scale. Pure + deterministic.
//
// Rule (confirmed with the user): points are a FREE numeric input, but when a PO
// story's points are >1 and are NOT a single allowed estimate, we auto-suggest a
// balanced breakdown into allowed values — 4→[2,2], 6→[3,3], 8→[3,5], 10→[5,5].

/** The allowed story-point scale: sub-1 grooming values + the Fibonacci-ish set. */
export const ALLOWED_POINTS = [0.2, 0.3, 0.5, 1, 2, 3, 5, 7] as const;

const EPS = 1e-9;

/** True when `n` equals one of the allowed scale values (float-tolerant). */
export function isAllowedPoint(n: number): boolean {
  return ALLOWED_POINTS.some((p) => Math.abs(p - n) < EPS);
}

/**
 * Suggest how a PO story's points break into Dev-task estimates:
 * - invalid / ≤ 0            → `[]`         (caller decides — typically one unestimated task)
 * - ≤ 1, or a single allowed → `[total]`    (one task, kept as-is)
 * - otherwise                → the most BALANCED pair of allowed values. An exact-sum pair
 *   is preferred (smallest |a−b|); if none sums to `total`, the pair whose sum is closest.
 *   Returned ascending: 4→[2,2], 6→[3,3], 8→[3,5], 10→[5,5].
 */
export function suggestBreakdown(total: number): number[] {
  if (!Number.isFinite(total) || total <= 0) return [];
  if (total <= 1 || isAllowedPoint(total)) return [total];

  // Pass 1 — an EXACT pair (a + b === total), most balanced.
  let best: [number, number] | null = null;
  for (const a of ALLOWED_POINTS) {
    for (const b of ALLOWED_POINTS) {
      if (Math.abs(a + b - total) > EPS) continue;
      if (best === null || Math.abs(a - b) < Math.abs(best[0] - best[1])) best = [a, b];
    }
  }

  // Pass 2 — no exact pair: closest sum, tie-broken by most balanced.
  if (best === null) {
    let bestDiff = Infinity;
    for (const a of ALLOWED_POINTS) {
      for (const b of ALLOWED_POINTS) {
        const diff = Math.abs(a + b - total);
        const tie = Math.abs(diff - bestDiff) <= EPS;
        if (
          diff < bestDiff - EPS ||
          (tie && (best === null || Math.abs(a - b) < Math.abs(best[0] - best[1])))
        ) {
          bestDiff = diff;
          best = [a, b];
        }
      }
    }
  }

  if (best === null) return [total];
  return [best[0], best[1]].sort((x, y) => x - y);
}
