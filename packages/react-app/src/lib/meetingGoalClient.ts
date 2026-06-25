// meetingGoalClient — Huddle meeting-goal store (v1.20, ADR-031).
// Wraps get_meeting_goal / set_meeting_goal via the HTTP bridge.

import { callTool } from "./mcpClient";
import type { MeetingGoal } from "./types";

export async function getMeetingGoal(sprintId: number): Promise<MeetingGoal> {
  return callTool<MeetingGoal>("jira", "get_meeting_goal", { sprintId });
}

export async function setMeetingGoal(sprintId: number, goal: string): Promise<MeetingGoal> {
  return callTool<MeetingGoal>("jira", "set_meeting_goal", { sprintId, goal });
}
