/**
 * Team store — synchronous JSON file read/write for per-board team rosters.
 *
 * Shape: { [boardId: string]: TeamMember[] }
 *
 * v1.8 (ADR-019): Second stateful store in the mcp-jira package. v1.65 (ADR-077): reads/writes
 * go through the storage port (json driver by default; still honors JIRA_TEAM_FILE).
 *
 * Reads tolerate a missing or corrupt doc (returns {}).
 * Writes may throw if the driver rejects the operation (e.g. FS/DB error).
 *
 * Never logs accountIds or any PII.
 */

import type { TeamMember } from "./types.js";
import { readDoc, writeDoc, currentScope } from "./storage/index.js";

/**
 * File-level shape: boardId (as string key) → TeamMember[]
 */
export type TeamFile = Record<string, TeamMember[]>;

/**
 * Read the team file and return its contents.
 * Returns {} on ENOENT or any JSON parse error (never throws).
 */
export function readTeams(): TeamFile {
  const parsed = readDoc(currentScope(), "team");
  // Validate that we have a plain object at the top level
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  return parsed as TeamFile;
}

/**
 * Write the team file via the storage port.
 * May throw on driver errors (e.g. permission denied writing, disk full).
 */
export function writeTeams(data: TeamFile): void {
  writeDoc(currentScope(), "team", data);
}
