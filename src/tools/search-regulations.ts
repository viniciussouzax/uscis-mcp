import { z } from "zod";
import { searchRegulations } from "../sources/ecfr.js";
import { envelope, toolError, toolText } from "../lib/envelope.js";
import { cache } from "../lib/cache.js";

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

  try {
    const { payload, sourceUrl } = await searchRegulations({
      query,
      maxResults: max_results,
      cfrPart: cfr_part,
    });

    // Trim noisy fields before returning
    const slim = {
      total_count: payload.meta.total_count,
      page: payload.meta.current_page,
      results: payload.results.map((r) => ({
        hierarchy: r.hierarchy,
        headings: r.headings,
        excerpt: r.full_text_excerpt,
        score: r.score,
      })),
    };

    return toolText(envelope(slim, sourceUrl));
  } catch (err) {
    // Stale fallback
    const staleKey = `ecfr:search:${query}:${max_results ?? 10}:${cfr_part ?? ""}`;
    const stale = cache.getStale(staleKey);
    if (stale) {
      return toolText(
        envelope(stale.value, "cached", {
          stale: true,
          staleReason: `upstream_unavailable: ${(err as Error).message}`,
          ageSeconds: Math.floor(stale.ageMs / 1000),
        }),
      );
    }
    return toolError(`search_regulations failed: ${(err as Error).message}`);
  }
}
