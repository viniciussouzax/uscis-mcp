import { z } from "zod";
import { searchBiaDecisions } from "../sources/eoir.js";
import { envelope, toolError, toolText } from "../lib/envelope.js";

export const searchBiaDecisionsSchema = {
  name: "search_bia_decisions",
  description:
    "Search precedential Board of Immigration Appeals (BIA) and Attorney " +
    "General decisions (I&N Dec., volumes 8 to present) published by DOJ EOIR. " +
    "Matches against case name, citation, and the published holding summary. " +
    "Returns citation, interim decision number (ID), PDF link, and holding " +
    "summary for each match. Non-precedential (unpublished) decisions are not " +
    "covered. Use get_bia_decision with a result's ID to fetch the full text. " +
    "The first search fetches all volume listings and may take ~15 seconds; " +
    "later searches are served from cache.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          'Free-text search over case names and holding summaries. Examples: ' +
          '"crime involving moral turpitude", "Silva-Trevino", "asylum particular social group".',
      },
      volume: {
        type: "integer",
        description:
          "Optional: restrict the search to a single I&N Dec. volume (e.g. 28). " +
          "Volumes 8 (1958) through the current volume are available.",
      },
      max_results: {
        type: "integer",
        description: "Max results to return (1-50, default 10).",
        minimum: 1,
        maximum: 50,
      },
    },
    required: ["query"],
  },
} as const;

// Coerce numerics — clients routinely send integers as JSON strings.
const Args = z.object({
  query: z.string().min(2),
  volume: z.coerce.number().int().min(1).max(99).optional(),
  max_results: z.coerce.number().int().min(1).max(50).optional(),
});

export async function searchBiaDecisionsHandler(input: unknown) {
  const parsed = Args.safeParse(input);
  if (!parsed.success) {
    return toolError(`Invalid arguments: ${parsed.error.message}`);
  }

  try {
    const { payload, sourceUrl } = await searchBiaDecisions(parsed.data.query, {
      volume: parsed.data.volume,
      maxResults: parsed.data.max_results,
    });
    return toolText(envelope(payload, sourceUrl));
  } catch (err) {
    return toolError(`search_bia_decisions failed: ${(err as Error).message}`);
  }
}
