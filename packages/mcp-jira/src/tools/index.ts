import type { ToolDef } from "../lib/toolDef.js";
import { createPoTicket } from "./createPoTicket.js";
import { createDevTicket } from "./createDevTicket.js";
import { getSprint } from "./getSprint.js";
import { getTicket } from "./getTicket.js";
import { updateTicket } from "./updateTicket.js";
import { getDailyHuddle } from "./getDailyHuddle.js";
import { createSprintTool } from "./createSprint.js";
import { listSprintsTool } from "./listSprints.js";
import { getSprintReportTool } from "./getSprintReport.js";
import { getVelocityTool } from "./getVelocity.js";
import { getLeavesTool } from "./getLeaves.js";
import { setLeavesTool } from "./setLeaves.js";
import { getAssignableUsersTool } from "./getAssignableUsers.js";
import { assignIssueTool } from "./assignIssue.js";
import { getRecentAssigneesTool } from "./getRecentAssignees.js";
import { getTeamMembersTool } from "./getTeamMembers.js";
import { setTeamMembersTool } from "./setTeamMembers.js";
import { getLinkedIssuesTool } from "./getLinkedIssues.js";
import { setSprintGoalTool } from "./setSprintGoal.js";

export const tools: ToolDef[] = [
  createPoTicket,
  createDevTicket,
  getSprint,
  getTicket,
  updateTicket,
  getDailyHuddle,
  createSprintTool,
  listSprintsTool,
  getSprintReportTool,
  getVelocityTool,
  getLeavesTool,
  setLeavesTool,
  getAssignableUsersTool,
  assignIssueTool,
  getRecentAssigneesTool,
  getTeamMembersTool,
  setTeamMembersTool,
  getLinkedIssuesTool,
  setSprintGoalTool,
];
