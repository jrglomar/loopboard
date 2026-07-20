/**
 * Pull-requests store — JSON file read/write for per-sprint code-review PR links.
 *
 * Shape: { [sprintId: string]: PullRequest[] }
 *
 * v1.16 (ADR-027): a manual store for daily Huddle code-review visibility (mirrors
 * leavesStore). v1.65 (ADR-077): reads/writes go through the storage port (json driver
 * by default; still honors JIRA_PRS_FILE). Reads tolerate a missing/corrupt doc (returns {}).
 */

import { readDoc, writeDoc, currentScope } from "./storage/index.js";

export interface PullRequest {
  id: string;
  url: string;
  title?: string;
  ticketKey?: string;
  status?: string; // free-text, e.g. "open" | "review" | "merged"
  addedAt: string; // ISO timestamp
}

/** File-level shape: sprintId (string key) → PullRequest[] */
export type PrsFile = Record<string, PullRequest[]>;

/** Read the PRs file. Returns {} on ENOENT or any JSON parse error. */
export function readPrs(): PrsFile {
  const parsed = readDoc(currentScope(), "prs");
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  return parsed as PrsFile;
}

/** Write the PRs doc via the storage port. */
export function writePrs(data: PrsFile): void {
  writeDoc(currentScope(), "prs", data);
}
