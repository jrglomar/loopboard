/**
 * Retro store — JSON file read/write for the per-sprint retrospective fields (v1.42, ADR-052).
 *
 * Shape: { [sprintId: string]: RetroEntry }
 *
 * Persisting the retro means it is written ONCE (on the Reports page) and the Full-report
 * export pre-fills from it instead of the team retyping everything at export time.
 * v1.65 (ADR-077): reads/writes go through the storage port (json driver by default; still
 * honors JIRA_RETRO_FILE). Reads tolerate a missing/corrupt doc (returns {}).
 */

import { readDoc, writeDoc, currentScope } from "./storage/index.js";

export interface RetroFields {
  reasonForDelays: string;
  whatWorkedWell: string;
  whatDidNotWork: string;
  plannedImprovements: string;
  kudos: string;
}

export interface RetroEntry extends RetroFields {
  updatedAt: string; // ISO timestamp
}

/** File-level shape: sprintId (string key) → RetroEntry */
export type RetroFile = Record<string, RetroEntry>;

/** Read the retro file. Returns {} on ENOENT or any JSON parse error. */
export function readRetros(): RetroFile {
  const parsed = readDoc(currentScope(), "retro");
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  return parsed as RetroFile;
}

/** Write the retro doc via the storage port. */
export function writeRetros(data: RetroFile): void {
  writeDoc(currentScope(), "retro", data);
}
