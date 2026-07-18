/**
 * Team store — synchronous JSON file read/write for per-board team rosters.
 *
 * Shape: { [boardId: string]: TeamMember[] }
 *
 * v1.8 (ADR-019): Second stateful store in the mcp-jira package.
 * Path is read from config at call time (getTeamFilePath()) so tests can
 * override JIRA_TEAM_FILE before any call.
 *
 * Reads tolerate a missing or corrupt file (returns {}).
 * Writes create the file and any parent directories as needed.
 * Writes may throw if the filesystem rejects the operation.
 *
 * Never logs accountIds or any PII.
 */

import * as fs from "fs";
import * as path from "path";
import type { TeamMember } from "./types.js";
import { getTeamFilePath } from "./config.js";
import { writeJsonAtomic } from "./atomicFile.js";

/**
 * File-level shape: boardId (as string key) → TeamMember[]
 */
export type TeamFile = Record<string, TeamMember[]>;

/**
 * Read the team file and return its contents.
 * Returns {} on ENOENT or any JSON parse error (never throws).
 */
export function readTeams(): TeamFile {
  const filePath = getTeamFilePath();
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    // Validate that we have a plain object at the top level
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    return parsed as TeamFile;
  } catch {
    // ENOENT, JSON.parse error, permission error on read → return empty
    return {};
  }
}

/**
 * Write the team file, creating parent directories as needed.
 * Throws on filesystem errors (e.g. permission denied writing, disk full).
 */
export function writeTeams(data: TeamFile): void {
  const filePath = getTeamFilePath();
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  writeJsonAtomic(filePath, data);
}
