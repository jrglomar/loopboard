// impedimentsClient — Huddle blockers store (v1.16, ADR-027).
// Wraps get_impediments / set_impediments via the HTTP bridge.

import { callTool } from "./mcpClient";
import type { Impediment } from "./types";

/** New/edited impediment as sent to set_impediments (id/createdAt filled server-side). */
export type ImpedimentInput = {
  id?: string;
  text: string;
  ticketKey?: string;
  createdAt?: string;
  resolved?: boolean;
};

export async function getImpediments(sprintId: number): Promise<Impediment[]> {
  const res = await callTool<{ sprintId: number; impediments: Impediment[] }>(
    "jira",
    "get_impediments",
    { sprintId }
  );
  return res.impediments;
}

export async function setImpediments(
  sprintId: number,
  impediments: ImpedimentInput[]
): Promise<Impediment[]> {
  const res = await callTool<{ sprintId: number; impediments: Impediment[] }>(
    "jira",
    "set_impediments",
    { sprintId, impediments }
  );
  return res.impediments;
}
