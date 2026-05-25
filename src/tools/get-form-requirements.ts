import { z } from "zod";
import { getFormRequirements } from "../sources/uscis-forms.js";
import { envelope, toolError, toolText } from "../lib/envelope.js";

export const getFormRequirementsSchema = {
  name: "get_form_requirements",
  description:
    "Retrieve the documentation checklist and filing instructions for a USCIS " +
    'form by parsing the official USCIS.gov form page. Returns "what to file", ' +
    '"where to file", "filing fees", and "special instructions" sections.',
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
