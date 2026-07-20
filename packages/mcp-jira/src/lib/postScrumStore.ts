/**
 * Post-scrum store — JSON file read/write for per-sprint, per-person post-scrum notes.
 *
 * Shape: { [sprintId: string]: PostScrumNote[] }
 *
 * v1.20 (ADR-031): a manual store for tracking post-standup "parking-lot" follow-ups
 * (mirrors impedimentsStore). v1.65 (ADR-077): reads/writes go through the storage port
 * (json driver by default; still honors JIRA_POST_SCRUM_FILE). Reads tolerate a
 * missing/corrupt doc (returns {}).
 */

import { readDoc, writeDoc, currentScope } from "./storage/index.js";

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
  const parsed = readDoc(currentScope(), "post-scrum");
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  return parsed as PostScrumFile;
}

/** Write the post-scrum doc via the storage port. */
export function writePostScrum(data: PostScrumFile): void {
  writeDoc(currentScope(), "post-scrum", data);
}
