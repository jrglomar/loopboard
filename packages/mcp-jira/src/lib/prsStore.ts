/**
 * Pull-requests store — JSON file read/write for per-sprint code-review PR links.
 *
 * Shape: { [sprintId: string]: PullRequest[] }
 *
 * v1.16 (ADR-027): a manual store for daily Huddle code-review visibility (mirrors
 * leavesStore). Path read from config at call time (getPrsFilePath()) so tests can
 * override JIRA_PRS_FILE. Reads tolerate a missing/corrupt file (returns {}).
 */

import * as fs from "fs";
import * as path from "path";
import { getPrsFilePath } from "./config.js";

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
  const filePath = getPrsFilePath();
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    return parsed as PrsFile;
  } catch {
    return {};
  }
}

/** Write the PRs file, creating parent directories as needed. */
export function writePrs(data: PrsFile): void {
  const filePath = getPrsFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}
