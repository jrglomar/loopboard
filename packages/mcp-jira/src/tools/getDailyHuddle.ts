import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import type { HuddleItem, GetDailyHuddleOutput } from "../lib/types.js";
import { getConfig } from "../lib/config.js";
import { getActiveAndFutureSprints, getSprintIssues } from "../lib/jiraClient.js";
import {
  sortSprintsLatestFirst,
  sortSprintsEarliestFirst,
  selectSprintFromActiveFuture,
} from "../lib/sprintSelect.js";
import { isCodeReview, parseCodeReviewStatuses } from "../lib/buckets.js";

const schema = z.object({
  boardId: z.number().int().positive().optional(),
  sprintId: z.number().int().positive().optional(),
});

// Use the canonical output type from types.ts
type HuddleOutput = GetDailyHuddleOutput;

function toHuddleItem(issue: {
  key: string;
  summary: string;
  assignee: string | null;
  status: string;
}): HuddleItem {
  return {
    key: issue.key,
    summary: issue.summary,
    assignee: issue.assignee,
    status: issue.status,
  };
}

/** Format an ISO date string to YYYY-MM-DD. */
function formatDate(isoDate: string | null): string {
  if (!isoDate) return "unknown";
  return isoDate.slice(0, 10);
}

async function handler(input: unknown): Promise<HuddleOutput> {
  const args = schema.parse(input);
  const cfg = getConfig();

  const boardId = args.boardId ?? parseInt(cfg.JIRA_DEV_BOARD_ID, 10);

  // Reuse the same sprint fetch + selection logic as get_active_sprint (v1.4)
  const rawSprints = await getActiveAndFutureSprints(boardId);
  const rawActive = rawSprints.filter((s) => s.state === "active");
  const rawFuture = rawSprints.filter((s) => s.state === "future");
  const sortedActive = sortSprintsLatestFirst(rawActive);
  const sortedFuture = sortSprintsEarliestFirst(rawFuture);
  const sprint = selectSprintFromActiveFuture(sortedActive, sortedFuture, boardId, args.sprintId);

  const issues = await getSprintIssues(sprint.id, 50);

  // Resolve code-review statuses from config
  const codeReviewStatuses = parseCodeReviewStatuses(cfg.JIRA_CODE_REVIEW_STATUSES);

  // Classify into buckets per CONTRACTS.md §4.6 (v1.2)
  // Precedence (top wins, an issue appears in at most one bucket):
  //   done > blocked > codeReview > inProgress > upNext
  const inProgress: HuddleItem[] = [];
  const codeReview: HuddleItem[] = [];
  const blocked: HuddleItem[] = [];
  const done: HuddleItem[] = [];
  const upNextCandidates: HuddleItem[] = [];

  for (const issue of issues) {
    const item = toHuddleItem(issue);

    if (issue.statusCategory === "done") {
      // done always wins — even if blocked===true
      done.push(item);
    } else if (issue.blocked) {
      // blocked and not done (a blocked code-review issue → blocked, not codeReview)
      blocked.push(item);
    } else if (isCodeReview(issue, codeReviewStatuses)) {
      // inprogress category, matches review status, and NOT blocked
      codeReview.push(item);
    } else if (issue.statusCategory === "inprogress") {
      // inprogress, not blocked, not code review
      inProgress.push(item);
    } else if (issue.statusCategory === "todo") {
      // upNext candidates — preserve board order; first 5 only
      upNextCandidates.push(item);
    }
  }

  const upNext = upNextCandidates.slice(0, 5);

  // Build summaryText per contract §4.6 (v1.2 format)
  // "Sprint '<name>' (<startDate> – <endDate>): <total> issues — <inProgress count> in progress,
  //  <codeReview count> in code review, <blocked count> blocked (<blocked keys comma-separated>),
  //  <done count> done, <upNext count> up next."
  // If 0 blocked: omit the "(keys)" parenthetical but keep "0 blocked,"
  const startDate = formatDate(sprint.startDate);
  const endDate = formatDate(sprint.endDate);
  const total = issues.length;
  const blockedKeys = blocked.map((b) => b.key).join(", ");

  const blockedSegment =
    blocked.length > 0
      ? ` ${blocked.length} blocked (${blockedKeys}),`
      : ` 0 blocked,`;

  const summaryText =
    `Sprint '${sprint.name}' (${startDate} – ${endDate}): ${total} issues — ` +
    `${inProgress.length} in progress,` +
    ` ${codeReview.length} in code review,` +
    blockedSegment +
    ` ${done.length} done, ${upNext.length} up next.`;

  return {
    sprintName: sprint.name,
    sprintId: sprint.id,
    boardId,
    generatedAt: new Date().toISOString(),
    inProgress,
    codeReview,
    blocked,
    done,
    upNext,
    summaryText,
  };
}

export const getDailyHuddle: ToolDef = {
  name: "get_daily_huddle",
  description:
    "Get a daily standup digest for the active or future sprint: in-progress, code-review, blocked, done, " +
    "and up-next items, plus a deterministic summaryText paragraph. No LLM calls. " +
    "Defaults to the latest active sprint (falls back to next future sprint). " +
    "Pass sprintId to pick a specific active or future sprint. " +
    "A future sprint with no issues yields empty buckets (planning view).",
  schema,
  handler,
};
