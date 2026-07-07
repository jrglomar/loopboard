/**
 * Retro store — JSON file read/write for the per-sprint retrospective fields (v1.42, ADR-052).
 *
 * Shape: { [sprintId: string]: RetroEntry }
 *
 * Persisting the retro means it is written ONCE (on the Reports page) and the Full-report
 * export pre-fills from it instead of the team retyping everything at export time.
 * Reads tolerate a missing/corrupt file (returns {}). Writes create the file + parent dirs.
 */

import * as fs from "fs";
import * as path from "path";
import { getRetroFilePath } from "./config.js";

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
  const filePath = getRetroFilePath();
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    return parsed as RetroFile;
  } catch {
    return {};
  }
}

/** Write the retro file, creating parent directories as needed. */
export function writeRetros(data: RetroFile): void {
  const filePath = getRetroFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}
