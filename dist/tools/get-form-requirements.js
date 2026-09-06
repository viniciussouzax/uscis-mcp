import { z } from "zod";
import { getFormRequirements } from "../sources/uscis-forms.js";
import { toolError } from "../lib/envelope.js";
import { serve } from "../lib/serve.js";
export const getFormRequirementsSchema = {
    name: "get_form_requirements",
    description: "Retrieve the documentation checklist and filing instructions for a USCIS " +
        "form by parsing the official USCIS.gov form page. Returns, when the page " +
        "publishes them: what_to_file (the Checklist of Required Initial Evidence, " +
        "followed to its standalone page when USCIS hosts it there), where_to_file, " +
        "when_to_file, filing_fees, form_filing_tips, special_instructions and " +
        "forms_and_documents. Fees come separately in filing_fee, read from the " +
        "official G-1055 Fee Schedule, since the form page itself only links to it. " +
        "Most forms have no single fee but one per circumstance — I-485 lists 14, " +
        "and I-765 and I-129 say only \"Varies\" — so match the condition before " +
        "quoting an amount, give the edition_date with it, and point to " +
        "fee_source_url. A wrong fee gets the filing rejected.",
    inputSchema: {
        type: "object",
        properties: {
            form_id: {
                type: "string",
                description: 'USCIS form number, e.g. "I-485", "I-130", "N-400", "I-765".',
            },
        },
        required: ["form_id"],
    },
};
const Args = z.object({ form_id: z.string().min(2) });
export async function getFormRequirementsHandler(input) {
    const parsed = Args.safeParse(input);
    if (!parsed.success) {
        return toolError(`Invalid arguments: ${parsed.error.message}`);
    }
    return serve("get_form_requirements", parsed.data, () => getFormRequirements(parsed.data.form_id));
}
//# sourceMappingURL=get-form-requirements.js.map