import { z } from "zod";
import { getSection } from "../sources/ecfr.js";
import { envelope, toolError, toolText } from "../lib/envelope.js";

export const getVisaCategoryRulesSchema = {
  name: "get_visa_category_rules",
  description:
    "Fetch the full current regulatory text for a specific CFR section " +
    'governing a visa category. Accepts citations like "8 CFR 214.2" or ' +
    '"8 CFR 214.2(h)". Pulls live from the eCFR versioner API.',
  inputSchema: {
    type: "object",
    properties: {
      citation: {
        type: "string",
        description:
          'CFR citation, e.g. "8 CFR 214.2" (general nonimmigrant rules), ' +
          '"8 CFR 214.2(h)" (H-1B), "8 CFR 245.1" (adjustment of status).',
      },
    },
    required: ["citation"],
  },
} as const;

const Args = z.object({ citation: z.string().min(1) });

export async function getVisaCategoryRulesHandler(input: unknown) {
  const parsed = Args.safeParse(input);
  if (!parsed.success) {
    return toolError(`Invalid arguments: ${parsed.error.message}`);
  }

  try {
    const { payload, sourceUrl } = await getSection(parsed.data.citation);
    return toolText(envelope(payload, sourceUrl));
  } catch (err) {
    return toolError(
      `get_visa_category_rules failed: ${(err as Error).message}`,
    );
  }
}
