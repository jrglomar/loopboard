// Tool registry — per CONTRACTS.md §1.1

import type { ToolDef } from "../lib/toolDef.js";
import { listPrsTool } from "./listPrs.js";
import { getPrTool } from "./getPr.js";
import { getPrReviewsTool } from "./getPrReviews.js";
import { linkPrToTicketTool } from "./linkPrToTicket.js";
import { syncPrLinksTool } from "./syncPrLinks.js";

export const tools: ToolDef[] = [
  listPrsTool,
  getPrTool,
  getPrReviewsTool,
  linkPrToTicketTool,
  syncPrLinksTool,
];
