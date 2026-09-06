
import { z } from "zod";
import {
  getProcessingTime,
  listFormTypes,
  listOffices,
  type FormType,
  type Office,
  type ProcessingTimeResult,
} from "../sources/immigrationtimes.js";
import { toolError } from "../lib/envelope.js";
import { serve } from "../lib/serve.js";

/** What list_options returns instead of a processing time. */
interface ProcessingTimeOptions {
  form_id: string;
  form_types: FormType[];
  offices_for_first_type: Office[];
}

export const getProcessingTimeSchema = {
  name: "get_processing_time",
  description:
    "Fetch published USCIS processing time estimates for a form. Estimates are " +
    "published per office and they disagree by a lot — 96 offices publish an " +
    "I-485 estimate spanning 6.5 to 70.5 months — so there is no single " +
    "national number. With office_code, you get that office's range " +
    '(scope="office"). Without it, you get the spread: median, fastest, ' +
    'slowest and every office (scope="distribution"), and no top-level range, ' +
    "because quoting one office as the answer would be misleading. Ask the " +
    "user which office is handling the case, or quote the median and say it " +
    "is a median.",
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
          'Office code, e.g. "NBC", "NYC", "LOS". Omit to get the spread ' +
          "across all offices instead of one office's figure. Use " +
          "list_options to see which codes publish data for this form.",
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

  return serve<ProcessingTimeResult | ProcessingTimeOptions>(
    "get_processing_time",
    parsed.data,
    async () => {
      if (list_options) {
        const types = await listFormTypes(form_id);
        // For the first type, also expose its offices
        const first = types[0];
        const offices = first
          ? await listOffices(form_id, first.form_type_id ?? first.form_type)
          : [];
        return {
          payload: { form_id, form_types: types, offices_for_first_type: offices },
          sourceUrl: `https://immigrationtimes.org/api/v1/${form_id.toLowerCase()}.json`,
        };
      }

      return getProcessingTime({
        formId: form_id,
        formType: form_type,
        officeCode: office_code,
      });
    },
  );
}
