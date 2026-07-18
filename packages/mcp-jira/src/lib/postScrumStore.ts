/**
 * Post-scrum store — JSON file read/write for per-sprint, per-person post-scrum notes.
 *
 * Shape: { [sprintId: string]: PostScrumNote[] }
 *
 * v1.20 (ADR-031): a manual store for tracking post-standup "parking-lot" follow-ups
 * (mirrors impedimentsStore). Path is read from config at call time so tests can override
 * JIRA_POST_SCRUM_FILE before any call. Reads tolerate a missing/corrupt file (returns {}).
 * Writes create the file + parent dirs; may throw on FS errors.
 */

import * as fs from "fs";
import * as path from "path";
import { getPostScrumFilePath } from "./config.js";
import { writeJsonAtomic } from "./atomicFile.js";

export interface PostScrumNote {
  id: string;
  person: string;
  note: string;
  createdAt: string; // ISO timestamp
  resolved?: boolean;
}

/** File-level shape: sprintId (string key) → PostScrumNote[] */
export type PostScrumFile = Record<string, PostScrumNote[]>;

/** Read the post-scrum file. Returns {} on ENOENT or any JSON parse error. */
export function readPostScrum(): PostScrumFile {
  const filePath = getPostScrumFilePath();
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    return parsed as PostScrumFile;
  } catch {
    return {};
  }
}

/** Write the post-scrum file, creating parent directories as needed. */
export function writePostScrum(data: PostScrumFile): void {
  const filePath = getPostScrumFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  writeJsonAtomic(filePath, data);
}
