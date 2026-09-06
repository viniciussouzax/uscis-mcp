import { z } from "zod";
import { searchRegulations } from "../sources/ecfr.js";
import { toolError } from "../lib/envelope.js";
import { serve } from "../lib/serve.js";

export const searchRegulationsSchema = {
  name: "search_regulations",
  description:
    "Search Title 8 of the Code of Federal Regulations (USCIS regulations) " +
    "via the official eCFR API. Returns a ranked list of matching sections " +
    "with hierarchy, headings, and short text excerpts. Best for finding " +
    "the right citation to then pass to get_visa_category_rules.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          'Free-text search query. Examples: "H-1B specialty occupation", "adjustment of status eligibility".',
      },
      max_results: {
        type: "integer",
        description: "Max results to return (1-50, default 10).",
        minimum: 1,
        maximum: 50,
      },
      cfr_part: {
        type: "string",
        description:
          'Optional: restrict to a specific Part of Title 8, e.g. "214" for nonimmigrant classifications.',
      },
    },
    required: ["query"],
  },
} as const;

const Args = z.object({
  query: z.string().min(1),
  max_results: z.number().int().min(1).max(50).optional(),
  cfr_part: z.string().optional(),
});

export async function searchRegulationsHandler(input: unknown) {
  const parsed = Args.safeParse(input);
  if (!parsed.success) {
    return toolError(`Invalid arguments: ${parsed.error.message}`);
  }
  const { query, max_results, cfr_part } = parsed.data;

  return serve("search_regulations", parsed.data, async () => {
    const { payload, sourceUrl } = await searchRegulations({
      query,
      maxResults: max_results,
      cfrPart: cfr_part,
    });

    // Trim noisy fields before returning. This slimmed shape is what gets
    // cached for the stale path too, so a stale answer has the same schema as
    // a fresh one — it used to cache the raw eCFR response and return this.
    return {
      payload: {
        total_count: payload.meta.total_count,
        page: payload.meta.current_page,
        results: payload.results.map((r) => ({
          hierarchy: r.hierarchy,
          headings: r.headings,
          excerpt: r.full_text_excerpt,
          score: r.score,
        })),
      },
      sourceUrl,
    };
  });
}
