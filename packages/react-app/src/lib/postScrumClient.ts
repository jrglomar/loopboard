// postScrumClient — Huddle post-scrum store (v1.20, ADR-031).
// Wraps get_post_scrum / set_post_scrum via the HTTP bridge.

import { callTool } from "./mcpClient";
import type { PostScrumNote } from "./types";

/** New/edited note as sent to set_post_scrum (id/createdAt filled server-side). */
export type PostScrumInput = {
  id?: string;
  person: string;
  note: string;
  createdAt?: string;
  resolved?: boolean;
};

export async function getPostScrum(sprintId: number): Promise<PostScrumNote[]> {
  const res = await callTool<{ sprintId: number; notes: PostScrumNote[] }>(
    "jira",
    "get_post_scrum",
    { sprintId }
  );
  return res.notes;
}

export async function setPostScrum(
  sprintId: number,
  notes: PostScrumInput[]
): Promise<PostScrumNote[]> {
  const res = await callTool<{ sprintId: number; notes: PostScrumNote[] }>(
    "jira",
    "set_post_scrum",
    { sprintId, notes }
  );
  return res.notes;
}
