// capacity.ts — pure capacity-model helpers (ADR-016, v1.5)
// No side effects. All functions are deterministic and unit-tested.
//
// Working days: Mon–Fri only (Sat=6, Sun=0 excluded). Holidays are not modeled
// (documented limitation in ADR-016). All dates are YYYY-MM-DD strings.

// ── sprintWorkingDays ─────────────────────────────────────────────────────────

/**
 * Return the list of Mon–Fri ISO date strings (YYYY-MM-DD) within [startDate, endDate]
 * inclusive. Returns [] when either date is null/undefined/invalid or start > end.
 *
 * @param startDate - ISO date string (YYYY-MM-DD) or null
 * @param endDate   - ISO date string (YYYY-MM-DD) or null
 */
export function sprintWorkingDays(
  startDate: string | null | undefined,
  endDate: string | null | undefined
): string[] {
  if (!startDate || !endDate) return [];

  // Parse only the date portion (ignore time/timezone for working-day purposes)
  const startParts = startDate.slice(0, 10).split("-").map(Number);
  const endParts = endDate.slice(0, 10).split("-").map(Number);

  if (startParts.length < 3 || endParts.length < 3) return [];

  // Use UTC midnight to avoid DST shifts
  const start = new Date(
    Date.UTC(startParts[0], startParts[1] - 1, startParts[2])
  );
  const end = new Date(
    Date.UTC(endParts[0], endParts[1] - 1, endParts[2])
  );

  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return [];

  const result: string[] = [];
  const cursor = new Date(start);

  while (cursor <= end) {
    const dow = cursor.getUTCDay(); // 0=Sun, 6=Sat
    if (dow !== 0 && dow !== 6) {
      // Mon–Fri
      result.push(cursor.toISOString().slice(0, 10));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return result;
}

// ── leaveDaysInSprint ─────────────────────────────────────────────────────────

/**
 * Count how many of an assignee's leave dates fall on a sprint working day.
 * Dates outside the sprint or on weekends are ignored.
 *
 * @param dates       - The assignee's leave dates (any YYYY-MM-DD; may include non-working days)
 * @param workingDays - The sprint's working days (from sprintWorkingDays)
 */
export function leaveDaysInSprint(
  dates: string[],
  workingDays: string[]
): number {
  if (dates.length === 0 || workingDays.length === 0) return 0;
  const workingSet = new Set(workingDays);
  let count = 0;
  for (const d of dates) {
    if (workingSet.has(d.slice(0, 10))) count++;
  }
  return count;
}

// ── CapacityInput / CapacityResult ────────────────────────────────────────────

export interface CapacityInput {
  /** Display names of all assignees on the sprint (or an empty array for no-team state) */
  assignees: string[];
  /** Working days for the sprint (from sprintWorkingDays) */
  workingDays: string[];
  /** Per-assignee leave dates (from get_leaves / useLeaves) */
  leavesByAssignee: Record<string, string[]>;
}

export interface CapacityResult {
  /** assignees × workingDays.length — total person-days available without any leaves */
  totalPersonDays: number;
  /** totalPersonDays − leavePersonDays */
  availablePersonDays: number;
  /** Sum of leave-days that fall on sprint working days */
  leavePersonDays: number;
  /**
   * available / total. 1 when total is 0 (no-team / no-dates guard).
   * Represents the fraction of full capacity the team has this sprint.
   */
  capacityFactor: number;
  /** Per-assignee working leave days (keyed by display name) */
  byAssigneeLeaveDays: Record<string, number>;
}

// ── computeCapacity ───────────────────────────────────────────────────────────

/**
 * Compute team capacity for a sprint, accounting for recorded leaves.
 *
 * Formula (ADR-016):
 *   totalPersonDays     = assignees.length × workingDays.length
 *   leavePersonDays     = Σ leaveDaysInSprint(assignee's dates, workingDays)
 *   availablePersonDays = totalPersonDays − leavePersonDays
 *   capacityFactor      = availablePersonDays / totalPersonDays  (1 when total = 0)
 *
 * Assignees with no leaves entry have 0 leave days (not an error).
 */
export function computeCapacity(input: CapacityInput): CapacityResult {
  const { assignees, workingDays, leavesByAssignee } = input;

  const totalPersonDays = assignees.length * workingDays.length;

  const byAssigneeLeaveDays: Record<string, number> = {};
  let leavePersonDays = 0;

  for (const name of assignees) {
    const dates = leavesByAssignee[name] ?? [];
    const days = leaveDaysInSprint(dates, workingDays);
    byAssigneeLeaveDays[name] = days;
    leavePersonDays += days;
  }

  const availablePersonDays = totalPersonDays - leavePersonDays;
  const capacityFactor =
    totalPersonDays === 0 ? 1 : availablePersonDays / totalPersonDays;

  return {
    totalPersonDays,
    availablePersonDays,
    leavePersonDays,
    capacityFactor,
    byAssigneeLeaveDays,
  };
}

// ── computeDevCapacity (v1.37, ADR-047) ───────────────────────────────────────

export interface DevCapacity {
  /** Developer display name */
  name: string;
  /** Working leave days this sprint (from computeCapacity().byAssigneeLeaveDays) */
  leaveDays: number;
  /** Points of capacity remaining this sprint = max(0, requiredPoints − leaveDays) */
  capacity: number;
}

/**
 * Per-developer remaining capacity for the sprint (v1.37, ADR-047).
 *
 * Model (confirmed with the user): each developer owes `requiredPoints` (N, the
 * offset policy's required points, e.g. 8). Each working leave day subtracts one
 * point of capacity, floored at 0. So 8 required − (1 VL + 1 offset) = 6.
 *
 *   capacity(dev) = max(0, requiredPoints − leaveDays(dev))
 *
 * Returns one row per developer in `leaveDaysByAssignee`, sorted by name.
 */
export function computeDevCapacity(
  requiredPoints: number,
  leaveDaysByAssignee: Record<string, number>
): DevCapacity[] {
  return Object.entries(leaveDaysByAssignee)
    .map(([name, leaveDays]) => ({
      name,
      leaveDays,
      capacity: Math.max(0, requiredPoints - leaveDays),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ── possibleCommittedVelocity ─────────────────────────────────────────────────

/**
 * Capacity-adjusted "possible committed velocity" heuristic.
 *
 * Formula: averageCompleted × capacityFactor
 *
 * When averageCompleted is 0 (no prior sprints), returns 0 (the factor is still
 * meaningful — display it separately as the capacity %).
 *
 * ADR-016: must be clearly labeled a heuristic, not a commitment.
 */
export function possibleCommittedVelocity(
  averageCompleted: number,
  capacityFactor: number
): number {
  return averageCompleted * capacityFactor;
}
