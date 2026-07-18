/**
 * Impediments store — JSON file read/write for per-sprint blockers/impediments.
 *
 * Shape: { [sprintId: string]: Impediment[] }
 *
 * v1.16 (ADR-027): a manual store for daily Huddle visibility (mirrors leavesStore).
 * Path is read from config at call time (getImpedimentsFilePath()) so tests can
 * override JIRA_IMPEDIMENTS_FILE before any call. Reads tolerate a missing/corrupt
 * file (returns {}). Writes create the file + parent dirs; may throw on FS errors.
 */

import * as fs from "fs";
import * as path from "path";
import { getImpedimentsFilePath } from "./config.js";
import { writeJsonAtomic } from "./atomicFile.js";

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
  const filePath = getImpedimentsFilePath();
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    return parsed as ImpedimentsFile;
  } catch {
    return {};
  }
}

/** Write the impediments file, creating parent directories as needed. */
export function writeImpediments(data: ImpedimentsFile): void {
  const filePath = getImpedimentsFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  writeJsonAtomic(filePath, data);
}
