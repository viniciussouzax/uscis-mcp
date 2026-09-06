import { z } from "zod";
import { getSection } from "../sources/ecfr.js";
import { envelope, toolError, toolText } from "../lib/envelope.js";
export const getVisaCategoryRulesSchema = {
    name: "get_visa_category_rules",
    description: "Fetch the current regulatory text for a CFR section or paragraph " +
        'governing a visa category. Accepts "8 CFR 214.2", "8 CFR 214.2(h)" or ' +
        '"8 CFR 214.2(h)(4)"; cite the paragraph when you know it, because whole ' +
        "sections are long and § 214.2 alone covers every nonimmigrant class. " +
        "Check paragraph_resolved: when it is shorter than paragraph_requested, " +
        "the deeper level could not be isolated and the parent was returned. Text " +
        "is capped at 40,000 characters — when truncated is true, narrow the " +
        "citation or read the rest at source_url. Pulls live from the eCFR " +
        "versioner API.",
    inputSchema: {
        type: "object",
        properties: {
            citation: {
                type: "string",
                description: 'CFR citation, e.g. "8 CFR 214.2" (general nonimmigrant rules), ' +
                    '"8 CFR 214.2(h)" (H-1B), "8 CFR 245.1" (adjustment of status).',
            },
        },
        required: ["citation"],
    },
};
const Args = z.object({ citation: z.string().min(1) });
export async function getVisaCategoryRulesHandler(input) {
    const parsed = Args.safeParse(input);
    if (!parsed.success) {
        return toolError(`Invalid arguments: ${parsed.error.message}`);
    }
    try {
        const { payload, sourceUrl } = await getSection(parsed.data.citation);
        return toolText(envelope(payload, sourceUrl));
    }
    catch (err) {
        return toolError(`get_visa_category_rules failed: ${err.message}`);
    }
}
//# sourceMappingURL=get-visa-category-rules.js.map