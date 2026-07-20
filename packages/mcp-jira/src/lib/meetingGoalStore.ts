/**
 * Meeting-goal store — JSON file read/write for the per-sprint "goal for today's meeting"
 * (the standup focus), distinct from the Jira sprint goal.
 *
 * Shape: { [sprintId: string]: { goal: string; updatedAt: string } }
 *
 * v1.20 (ADR-031): a manual store for daily Huddle focus (mirrors impedimentsStore).
 * v1.65 (ADR-077): reads/writes go through the storage port (json driver by default;
 * still honors JIRA_MEETING_GOAL_FILE). Reads tolerate a missing/corrupt doc (returns {}).
 */

import { readDoc, writeDoc, currentScope } from "./storage/index.js";

export interface MeetingGoal {
  goal: string;
  updatedAt: string; // ISO timestamp
}

/** File-level shape: sprintId (string key) → MeetingGoal */
export type MeetingGoalFile = Record<string, MeetingGoal>;

/** Read the meeting-goal file. Returns {} on ENOENT or any JSON parse error. */
export function readMeetingGoals(): MeetingGoalFile {
  const parsed = readDoc(currentScope(), "meeting-goal");
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  return parsed as MeetingGoalFile;
}

/** Write the meeting-goal doc via the storage port. */
export function writeMeetingGoals(data: MeetingGoalFile): void {
  writeDoc(currentScope(), "meeting-goal", data);
}
