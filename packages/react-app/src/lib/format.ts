// format.ts — shared pure formatting helpers (ADR-013, v1.4.1)
// No side effects; unit-tested in format.test.ts.

/**
 * Format a point value with at most 2 decimal places, trailing zeros trimmed.
 *
 * Examples:
 *   formatPoints(30)         → "30"
 *   formatPoints(13.5)       → "13.5"
 *   formatPoints(29.75)      → "29.75"
 *   formatPoints(13.333333)  → "13.33"
 *   formatPoints(0)          → "0"
 *   formatPoints(1.005)      → "1.01"  (standard JS rounding)
 */
export function formatPoints(n: number): string {
  // toFixed(2) rounds to 2 decimals, then parseFloat strips trailing zeros
  return parseFloat(n.toFixed(2)).toString();
}
