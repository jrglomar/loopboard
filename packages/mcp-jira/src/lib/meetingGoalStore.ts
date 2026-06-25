/**
 * Meeting-goal store — JSON file read/write for the per-sprint "goal for today's meeting"
 * (the standup focus), distinct from the Jira sprint goal.
 *
 * Shape: { [sprintId: string]: { goal: string; updatedAt: string } }
 *
 * v1.20 (ADR-031): a manual store for daily Huddle focus (mirrors impedimentsStore). Path is
 * read from config at call time so tests can override JIRA_MEETING_GOAL_FILE before any call.
 * Reads tolerate a missing/corrupt file (returns {}). Writes create the file + parent dirs.
 */

import * as fs from "fs";
import * as path from "path";
import { getMeetingGoalFilePath } from "./config.js";

export interface MeetingGoal {
  goal: string;
  updatedAt: string; // ISO timestamp
}

/** File-level shape: sprintId (string key) → MeetingGoal */
export type MeetingGoalFile = Record<string, MeetingGoal>;

/** Read the meeting-goal file. Returns {} on ENOENT or any JSON parse error. */
export function readMeetingGoals(): MeetingGoalFile {
  const filePath = getMeetingGoalFilePath();
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    return parsed as MeetingGoalFile;
  } catch {
    return {};
  }
}

/** Write the meeting-goal file, creating parent directories as needed. */
export function writeMeetingGoals(data: MeetingGoalFile): void {
  const filePath = getMeetingGoalFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}
