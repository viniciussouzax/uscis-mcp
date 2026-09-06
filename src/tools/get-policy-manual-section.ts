import { z } from "zod";
import { getPolicyManualSection, SLUG_REGEX } from "../sources/policy-manual.js";
import { envelope, toolError, toolText } from "../lib/envelope.js";

export const getPolicyManualSectionSchema = {
  name: "get_policy_manual_section",
  description:
    "Fetch the policy text of a USCIS Policy Manual volume, part, or chapter " +
    "by slug. Returns the page title, structured sections (each with a heading, " +
    "text, char_count and truncated flag), and a full_text concatenation. " +
    "Sections are capped at 5,000 characters: when truncated is true the text " +
    "is incomplete, and the rest is at source_url — say so rather than " +
    "answering as if the passage were whole. Obtain slugs from get_policy_manual_toc.",
  inputSchema: {
    type: "object",
    properties: {
      slug: {
        type: "string",
        description:
          'Policy manual slug, e.g. "volume-1-part-a-chapter-1", ' +
          '"volume-1-part-a", or "volume-1". Obtain slugs from get_policy_manual_toc.',
      },
    },
    required: ["slug"],
  },
} as const;

const Args = z.object({
  slug: z
    .string()
    .regex(
      SLUG_REGEX,
      'Slug must match a pattern like "volume-1", "volume-1-part-a", or "volume-1-part-a-chapter-1"',
    ),
});

export async function getPolicyManualSectionHandler(input: unknown) {
  const parsed = Args.safeParse(input);
  if (!parsed.success) {
    return toolError(`Invalid arguments: ${parsed.error.message}`);
  }

  try {
    const { payload, sourceUrl } = await getPolicyManualSection(
      parsed.data.slug,
    );
    return toolText(envelope(payload, sourceUrl));
  } catch (err) {
    return toolError(
      `get_policy_manual_section failed: ${(err as Error).message}`,
    );
  }
}
