/**
 * Huddle "By person" regrouping (v1.3, ADR-010).
 * Pure client-side regroup of the SAME get_daily_huddle data.
 * No network calls. Uses only inProgress + codeReview + blocked buckets
 * (done/upNext are sprint-wide, not individual standup items).
 */

import type { GetDailyHuddleOutput, HuddleItem } from "./types";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PersonGroup {
  /** Display name, or null for unassigned items */
  assignee: string | null;
  /** The assignee's initials (derived from display name) */
  initials: string;
  inProgress: HuddleItem[];
  codeReview: HuddleItem[];
  blocked: HuddleItem[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Derive initials from a display name.
 * "Alice Johnson" → "AJ", "Bob" → "B", null → "?"
 */
export function deriveInitials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0]?.toUpperCase() ?? "?";
  // First + last initial
  return (
    (parts[0][0]?.toUpperCase() ?? "") +
    (parts[parts.length - 1][0]?.toUpperCase() ?? "")
  );
}

// ── regroupByPerson ───────────────────────────────────────────────────────────

/**
 * Regroup get_daily_huddle data by assignee for a "walk-by-person" standup.
 *
 * Buckets included: inProgress + codeReview + blocked.
 * done/upNext are excluded (they are sprint-wide artifacts).
 * Assignees sorted: named assignees alpha, unassigned last.
 *
 * @param data - The full get_daily_huddle output
 */
export function regroupByPerson(data: GetDailyHuddleOutput): PersonGroup[] {
  const groups = new Map<string | null, PersonGroup>();

  function getOrCreate(assignee: string | null): PersonGroup {
    const key = assignee; // null is a valid Map key
    if (!groups.has(key)) {
      groups.set(key, {
        assignee,
        initials: deriveInitials(assignee),
        inProgress: [],
        codeReview: [],
        blocked: [],
      });
    }
    return groups.get(key)!;
  }

  for (const item of data.inProgress) {
    getOrCreate(item.assignee).inProgress.push(item);
  }
  for (const item of data.codeReview) {
    getOrCreate(item.assignee).codeReview.push(item);
  }
  for (const item of data.blocked) {
    getOrCreate(item.assignee).blocked.push(item);
  }

  // Sort: named assignees alpha first, unassigned last
  return [...groups.values()].sort((a, b) => {
    if (a.assignee === null && b.assignee === null) return 0;
    if (a.assignee === null) return 1;
    if (b.assignee === null) return -1;
    return a.assignee.localeCompare(b.assignee);
  });
}

// ── buildByPersonClipboardText ────────────────────────────────────────────────

/**
 * Build the clipboard plain-text for "By person" mode.
 * Groups items by assignee with inProgress + codeReview + blocked under each.
 */
export function buildByPersonClipboardText(
  sprintName: string,
  groups: PersonGroup[]
): string {
  const lines: string[] = [
    `=== Daily Huddle (By Person): ${sprintName} ===`,
    "",
  ];

  for (const group of groups) {
    const name = group.assignee ?? "Unassigned";
    lines.push(`--- ${name} ---`);

    const allItems: Array<{ label: string; item: HuddleItem }> = [
      ...group.inProgress.map((i) => ({ label: "In Progress", item: i })),
      ...group.codeReview.map((i) => ({ label: "Code Review", item: i })),
      ...group.blocked.map((i) => ({ label: "⚠ Blocked", item: i })),
    ];

    if (allItems.length === 0) {
      lines.push("  (no active items)");
    } else {
      for (const { label, item } of allItems) {
        lines.push(`  [${label}] ${item.key}: ${item.summary}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}
