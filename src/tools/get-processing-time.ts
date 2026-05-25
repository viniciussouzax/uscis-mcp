import { z } from "zod";
import { getProcessingTime, listFormTypes, listOffices } from "../sources/egov.js";
import { envelope, toolError, toolText } from "../lib/envelope.js";

export const getProcessingTimeSchema = {
  name: "get_processing_time",
  description:
    "Fetch the current USCIS published processing time estimate for a form, " +
    "sub-type, and service center. If sub-type or office is omitted, the " +
    "tool picks sensible defaults (first available sub-type; SCOPS office " +
    "where applicable). Returns a months-range plus the publication date.",
  inputSchema: {
    type: "object",
    properties: {
      form_id: {
        type: "string",
        description: 'USCIS form number, e.g. "I-485", "N-400", "I-765".',
      },
      form_type: {
        type: "string",
        description:
          "Optional sub-category key (e.g. employment-based vs family-based). " +
          "Call list_form_types via get_processing_time with form_id alone to discover.",
      },
      office_code: {
        type: "string",
        description:
          "Optional service center code (e.g. SCOPS, NSC, VSC). If omitted, " +
          "the tool defaults to SCOPS where present.",
      },
      list_options: {
        type: "boolean",
        description:
          "If true, returns the list of available form_type and office_code options " +
          "for the form instead of a processing time. Useful for exploration.",
      },
    },
    required: ["form_id"],
  },
} as const;

const Args = z.object({
  form_id: z.string().min(2),
  form_type: z.string().optional(),
  office_code: z.string().optional(),
  list_options: z.boolean().optional(),
});

export async function getProcessingTimeHandler(input: unknown) {
  const parsed = Args.safeParse(input);
  if (!parsed.success) {
    return toolError(`Invalid arguments: ${parsed.error.message}`);
  }
  const { form_id, form_type, office_code, list_options } = parsed.data;

  try {
    if (list_options) {
      const types = await listFormTypes(form_id);
      // For the first type, also expose its offices
      const first = types[0];
      const offices = first
        ? await listOffices(form_id, first.form_type_id ?? first.form_type)
        : [];
      return toolText(
        envelope(
          {
            form_id,
            form_types: types,
            offices_for_first_type: offices,
          },
          "https://egov.uscis.gov/processing-times/api",
        ),
      );
    }

    const { payload, sourceUrl } = await getProcessingTime({
      formId: form_id,
      formType: form_type,
      officeCode: office_code,
    });
    return toolText(envelope(payload, sourceUrl));
  } catch (err) {
    return toolError(`get_processing_time failed: ${(err as Error).message}`);
  }
}
