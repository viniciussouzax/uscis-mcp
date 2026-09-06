import { z } from "zod";
import { getSection } from "../sources/ecfr.js";
import { envelope, toolError, toolText } from "../lib/envelope.js";

export const getVisaCategoryRulesSchema = {
  name: "get_visa_category_rules",
  description:
    "Fetch the current regulatory text for a CFR section or paragraph " +
    'governing a visa category. Accepts "8 CFR 214.2", "8 CFR 214.2(h)" or ' +
    '"8 CFR 214.2(h)(4)". The full text is returned with no length limit, so ' +
    "cite the narrowest paragraph that answers the question: § 214.2 is about " +
    "700,000 characters covering every nonimmigrant class, § 214.2(h) is " +
    "253,000, § 214.2(h)(4) is 31,000. Check paragraph_resolved — when it is " +
    "shorter than paragraph_requested, the deeper level could not be isolated " +
    "and the parent was returned. Pulls live from the eCFR versioner API.",
  inputSchema: {
    type: "object",
    properties: {
      citation: {
        type: "string",
        description:
          'CFR citation, e.g. "8 CFR 214.2" (general nonimmigrant rules), ' +
          '"8 CFR 214.2(h)" (H-1B), "8 CFR 245.1" (adjustment of status).',
      },
      max_chars: {
        type: "integer",
        minimum: 1000,
        description:
          "Optional ceiling on returned characters. Omit to get the whole " +
          "text. Set it only if your context is tight; truncated will say " +
          "whether it was applied, and char_count always reports the full size.",
      },
    },
    required: ["citation"],
  },
} as const;

const Args = z.object({
  citation: z.string().min(1),
  max_chars: z.number().int().min(1000).optional(),
});

export async function getVisaCategoryRulesHandler(input: unknown) {
  const parsed = Args.safeParse(input);
  if (!parsed.success) {
    return toolError(`Invalid arguments: ${parsed.error.message}`);
  }

  try {
    const { payload, sourceUrl } = await getSection(parsed.data.citation, {
      maxChars: parsed.data.max_chars,
    });
    return toolText(envelope(payload, sourceUrl));
  } catch (err) {
    return toolError(
      `get_visa_category_rules failed: ${(err as Error).message}`,
    );
  }
}
