/**
 * Impediments store — JSON file read/write for per-sprint blockers/impediments.
 *
 * Shape: { [sprintId: string]: Impediment[] }
 *
 * v1.16 (ADR-027): a manual store for daily Huddle visibility (mirrors leavesStore).
 * v1.65 (ADR-077): reads/writes go through the storage port (json driver by default;
 * still honors JIRA_IMPEDIMENTS_FILE). Reads tolerate a missing/corrupt doc (returns {}).
 */

import { readDoc, writeDoc, currentScope } from "./storage/index.js";

export interface Impediment {
  id: string;
  text: string;
  ticketKey?: string;
  createdAt: string; // ISO timestamp
  resolved?: boolean;
}

/** File-level shape: sprintId (string key) → Impediment[] */
export type ImpedimentsFile = Record<string, Impediment[]>;

/** Read the impediments file. Returns {} on ENOENT or any JSON parse error. */
export function readImpediments(): ImpedimentsFile {
  const parsed = readDoc(currentScope(), "impediments");
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  return parsed as ImpedimentsFile;
}

/** Write the impediments doc via the storage port. */
export function writeImpediments(data: ImpedimentsFile): void {
  writeDoc(currentScope(), "impediments", data);
}
