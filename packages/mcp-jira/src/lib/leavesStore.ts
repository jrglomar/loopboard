/**
 * Leaves store — synchronous JSON file read/write for per-sprint leave dates.
 *
 * Shape: { [sprintId: string]: { [assigneeName: string]: string[] } }
 * Dates are ISO date strings "YYYY-MM-DD", deduped + sorted.
 *
 * v1.5 (ADR-016): First stateful store in the mcp-jira package.
 * Path is read from config at call time (getLeavesFilePath()) so tests can
 * override JIRA_LEAVES_FILE before any call.
 *
 * Reads tolerate a missing or corrupt file (returns {}).
 * Writes create the file and any parent directories as needed.
 * Writes may throw if the filesystem rejects the operation.
 */

import * as fs from "fs";
import * as path from "path";
import { getLeavesFilePath } from "./config.js";

/**
 * File-level shape: sprintId (as string key) → assignee → ISO date[]
 */
export type LeavesFile = Record<string, Record<string, string[]>>;

/**
 * Read the leaves file and return its contents.
 * Returns {} on ENOENT or any JSON parse error (never throws).
 */
export function readLeaves(): LeavesFile {
  const filePath = getLeavesFilePath();
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    // Validate that we have a plain object at the top level
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    return parsed as LeavesFile;
  } catch {
    // ENOENT, JSON.parse error, permission error on read → return empty
    return {};
  }
}

/**
 * Write the leaves file, creating parent directories as needed.
 * Throws on filesystem errors (e.g. permission denied writing, disk full).
 */
export function writeLeaves(data: LeavesFile): void {
  const filePath = getLeavesFilePath();
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}
