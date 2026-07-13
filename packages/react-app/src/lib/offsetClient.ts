// Offset-ledger client — CONTRACTS.md §4.26, ADR-038.
// Wraps get_offset_ledger / set_offset_for_sprint / set_offset_adjustment via the HTTP bridge.

import { callTool } from "./mcpClient";
import type { OffsetSummary } from "./types";

export type OffsetLedger = Record<string, OffsetSummary>;

/** Fetch each developer's computed offset standing (earned/spent/manualAdjust/balance). */
export async function getOffsetLedger(): Promise<OffsetLedger> {
  const res = await callTool<{ entries: OffsetLedger }>("jira", "get_offset_ledger", {});
  return res.entries;
}

/** Record the auto-computed earned/spent snapshot for a sprint (idempotent upsert). */
export async function setOffsetForSprint(
  sprintId: number,
  entries: Array<{ assignee: string; earned: number; spent: number }>
): Promise<OffsetLedger> {
  const res = await callTool<{ entries: OffsetLedger }>("jira", "set_offset_for_sprint", {
    sprintId,
    entries,
  });
  return res.entries;
}

/** Set a developer's single manual offset adjustment / opening balance (absolute signed delta). */
export async function setOffsetAdjustment(
  assignee: string,
  manualAdjust: number
): Promise<OffsetLedger> {
  const res = await callTool<{ entries: OffsetLedger }>("jira", "set_offset_adjustment", {
    assignee,
    manualAdjust,
  });
  return res.entries;
}

/** v1.54 (ADR-065): append a manual adjustment to a developer's log (signed non-zero amount + note). */
export async function addOffsetAdjustment(
  assignee: string,
  amount: number,
  note?: string
): Promise<OffsetLedger> {
  const res = await callTool<{ entries: OffsetLedger }>("jira", "add_offset_adjustment", {
    assignee,
    amount,
    ...(note && note.trim() ? { note: note.trim() } : {}),
  });
  return res.entries;
}

/** v1.54 (ADR-065): remove a manual adjustment from a developer's log by id. */
export async function deleteOffsetAdjustment(assignee: string, id: string): Promise<OffsetLedger> {
  const res = await callTool<{ entries: OffsetLedger }>("jira", "delete_offset_adjustment", {
    assignee,
    id,
  });
  return res.entries;
}
