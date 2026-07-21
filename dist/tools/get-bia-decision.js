import { z } from "zod";
import { getBiaDecisionText } from "../sources/eoir.js";
import { envelope, toolError, toolText } from "../lib/envelope.js";
export const getBiaDecisionSchema = {
    name: "get_bia_decision",
    description: "Fetch the full text of a precedential BIA or Attorney General decision " +
        "by downloading its official PDF from justice.gov and extracting the text. " +
        "Identify the decision by interim decision number (preferred — get it from " +
        "search_bia_decisions) or by I&N Dec. citation. Long decisions are " +
        "truncated at 40,000 characters; the source PDF URL is always included.",
    inputSchema: {
        type: "object",
        properties: {
            id: {
                type: "string",
                description: 'Interim decision number, e.g. "4084". Returned as "id" by search_bia_decisions.',
            },
            citation: {
                type: "string",
                description: 'I&N Dec. citation, e.g. "28 I&N Dec. 883". A full case cite like ' +
                    '"Matter of Silva-Trevino, 26 I&N Dec. 550 (A.G. 2015)" also works. ' +
                    'Used only if "id" is not given.',
            },
        },
        required: [],
    },
};
// Coerce id — clients send it as a bare number as often as a string.
const Args = z
    .object({
    id: z.coerce
        .string()
        .regex(/^(ID\s*)?\d{1,5}$/i, 'id must be a number like "4084"')
        .optional(),
    citation: z.string().min(5).optional(),
})
    .refine((a) => a.id || a.citation, {
    message: 'Provide either "id" or "citation"',
});
export async function getBiaDecisionHandler(input) {
    const parsed = Args.safeParse(input);
    if (!parsed.success) {
        return toolError(`Invalid arguments: ${parsed.error.message}`);
    }
    try {
        const { payload, sourceUrl } = await getBiaDecisionText(parsed.data);
        return toolText(envelope(payload, sourceUrl));
    }
    catch (err) {
        return toolError(`get_bia_decision failed: ${err.message}`);
    }
}
//# sourceMappingURL=get-bia-decision.js.map