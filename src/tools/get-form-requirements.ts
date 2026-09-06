import { z } from "zod";
import { getFormRequirements } from "../sources/uscis-forms.js";
import { envelope, toolError, toolText } from "../lib/envelope.js";

export const getFormRequirementsSchema = {
  name: "get_form_requirements",
  description:
    "Retrieve the documentation checklist and filing instructions for a USCIS " +
    "form by parsing the official USCIS.gov form page. Returns, when the page " +
    "publishes them: what_to_file (the Checklist of Required Initial Evidence, " +
    "followed to its standalone page when USCIS hosts it there), where_to_file, " +
    "when_to_file, filing_fees, form_filing_tips, special_instructions and " +
    "forms_and_documents. Note that filing_fees is only a pointer to the USCIS " +
    "Fee Schedule (form G-1055) — USCIS does not publish the amount on the form " +
    "page, so never quote a fee from this tool.",
  inputSchema: {
    type: "object",
    properties: {
      form_id: {
        type: "string",
        description:
          'USCIS form number, e.g. "I-485", "I-130", "N-400", "I-765".',
      },
    },
    required: ["form_id"],
  },
} as const;

const Args = z.object({ form_id: z.string().min(2) });

export async function getFormRequirementsHandler(input: unknown) {
  const parsed = Args.safeParse(input);
  if (!parsed.success) {
    return toolError(`Invalid arguments: ${parsed.error.message}`);
  }

  try {
    const { payload, sourceUrl } = await getFormRequirements(parsed.data.form_id);
    return toolText(envelope(payload, sourceUrl));
  } catch (err) {
    return toolError(
      `get_form_requirements failed: ${(err as Error).message}`,
    );
  }
}
