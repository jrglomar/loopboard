// Retro client (v1.42, ADR-052) — wraps get_retro / set_retro. CONTRACTS.md §4.28.
// The persisted sprint retrospective; also pre-fills the Full-report export dialog.

import { callTool } from "./mcpClient";

/** The five free-text retrospective fields (all optional; empty string = unset). */
export interface RetroFields {
  reasonForDelays: string;
  whatWorkedWell: string;
  whatDidNotWork: string;
  plannedImprovements: string;
  kudos: string;
}

export interface RetroData extends RetroFields {
  updatedAt: string; // ISO timestamp
}

interface RetroEnvelope {
  sprintId: number;
  retro: RetroData | null;
}

/** Fetch the sprint's retro; null when never set/cleared. */
export async function getRetro(sprintId: number): Promise<RetroData | null> {
  const res = await callTool<RetroEnvelope>("jira", "get_retro", { sprintId });
  return res.retro;
}

/** Replace the sprint's retro (all-empty clears). Returns the stored retro (or null). */
export async function setRetro(
  sprintId: number,
  fields: RetroFields
): Promise<RetroData | null> {
  const res = await callTool<RetroEnvelope>("jira", "set_retro", { sprintId, ...fields });
  return res.retro;
}
