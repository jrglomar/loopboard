import { z } from "zod";
import type { ToolDef } from "../lib/toolDef.js";
import type { IssueSummary, ActiveSprintRef, GetActiveSprintOutput } from "../lib/types.js";
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
  maxResults: z.number().int().positive().optional(),
});

// Use the canonical output type from types.ts
type SprintOutput = GetActiveSprintOutput;

async function handler(input: unknown): Promise<SprintOutput> {
  const args = schema.parse(input);
  const cfg = getConfig();

  const boardId = args.boardId ?? parseInt(cfg.JIRA_DEV_BOARD_ID, 10);
  const maxResults = args.maxResults ?? 50;

  // Step 1: get all active+future sprints in one call (v1.4)
  const rawSprints = await getActiveAndFutureSprints(boardId);

  // Step 2: split into active and future, sort each group
  const rawActive = rawSprints.filter((s) => s.state === "active");
  const rawFuture = rawSprints.filter((s) => s.state === "future");

  const sortedActive = sortSprintsLatestFirst(rawActive);
  const sortedFuture = sortSprintsEarliestFirst(rawFuture);

  // Step 3: select sprint from active∪future (v1.4 error messages)
  const sprint = selectSprintFromActiveFuture(sortedActive, sortedFuture, boardId, args.sprintId);

  // Step 4: build activeSprints and futureSprints ref arrays
  const activeSprints: ActiveSprintRef[] = sortedActive.map((s) => ({
    id: s.id,
    name: s.name,
    startDate: s.startDate,
    endDate: s.endDate,
    goal: s.goal,
  }));

  const futureSprints: ActiveSprintRef[] = sortedFuture.map((s) => ({
    id: s.id,
    name: s.name,
    startDate: s.startDate,
    endDate: s.endDate,
    goal: s.goal,
  }));

  // Step 5: get sprint issues
  const issues = await getSprintIssues(sprint.id, maxResults);

  // Step 6: resolve code-review status set from config
  const codeReviewStatuses = parseCodeReviewStatuses(cfg.JIRA_CODE_REVIEW_STATUSES);

  // Step 7: bucket each issue (v1.2):
  // codereview if isCodeReview matches; else statusCategory bucket.
  // inprogress bucket EXCLUDES code-review issues.
  const todo: IssueSummary[] = [];
  const inprogress: IssueSummary[] = [];
  const codereview: IssueSummary[] = [];
  const done: IssueSummary[] = [];

  for (const issue of issues) {
    if (issue.statusCategory === "done") {
      done.push(issue);
    } else if (issue.statusCategory === "todo") {
      todo.push(issue);
    } else if (isCodeReview(issue, codeReviewStatuses)) {
      // inprogress category, status name matches configured review statuses
      codereview.push(issue);
    } else {
      // inprogress but not code review
      inprogress.push(issue);
    }
  }

  // Step 8: compute totals
  const total = issues.length;
  const blockedCount = issues.filter((i) => i.blocked).length;
  const storyPointsTotal = issues.reduce(
    (sum, i) => sum + (i.storyPoints ?? 0),
    0
  );
  // storyPointsDone: strictly the "done" bucket (Done column count — unchanged)
  const storyPointsDone = done.reduce(
    (sum, i) => sum + (i.storyPoints ?? 0),
    0
  );
  // storyPointsCodeReview: v1.5 (ADR-014) — sum of code-review bucket points
  // (Dashboard progress: done + codeReview = DoD-completed)
  const storyPointsCodeReview = codereview.reduce(
    (sum, i) => sum + (i.storyPoints ?? 0),
    0
  );

  return {
    sprint: {
      id: sprint.id,
      name: sprint.name,
      state: sprint.state,
      startDate: sprint.startDate,
      endDate: sprint.endDate,
      goal: sprint.goal,
    },
    activeSprints,
    futureSprints,
    issuesByStatus: { todo, inprogress, codereview, done },
    totals: {
      total,
      todo: todo.length,
      inprogress: inprogress.length,
      codereview: codereview.length,
      done: done.length,
      blocked: blockedCount,
      storyPointsTotal,
      storyPointsDone,
      storyPointsCodeReview,
    },
  };
}

export const getSprint: ToolDef = {
  name: "get_active_sprint",
  description:
    "Get the active or future sprint for a Jira board, with all issues bucketed by status " +
    "(todo/inprogress/codereview/done) and totals including story points and blocked count. " +
    "Fetches both active and future sprints. Defaults to the latest active sprint; " +
    "falls back to the next future sprint when no active sprint exists. " +
    "Pass sprintId to select a specific active or future sprint. " +
    "activeSprints lists all active sprints (latest-first); futureSprints lists all future sprints (next-up first).",
  schema,
  handler,
};
