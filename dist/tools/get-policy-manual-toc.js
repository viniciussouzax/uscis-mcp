import { z } from "zod";
import { getPolicyManualToc } from "../sources/policy-manual.js";
import { envelope, toolError, toolText } from "../lib/envelope.js";
export const getPolicyManualTocSchema = {
    name: "get_policy_manual_toc",
    description: "Retrieve the table of contents for the USCIS Policy Manual. " +
        "Returns a structured tree of volumes, parts, and chapters with their " +
        "slugs and titles. Use the returned slugs with get_policy_manual_section " +
        "to fetch the policy text of any chapter.",
    inputSchema: {
        type: "object",
        properties: {
            volume: {
                type: "string",
                description: 'Optional: filter to a single volume slug, e.g. "volume-2". ' +
                    "If omitted, all 12 volumes are returned.",
            },
        },
        required: [],
    },
};
const Args = z.object({
    volume: z.string().optional(),
});
export async function getPolicyManualTocHandler(input) {
    const parsed = Args.safeParse(input);
    if (!parsed.success) {
        return toolError(`Invalid arguments: ${parsed.error.message}`);
    }
    try {
        const { payload, sourceUrl } = await getPolicyManualToc();
        let data = payload;
        if (parsed.data.volume) {
            const vol = parsed.data.volume;
            const filtered = payload.volumes.filter((v) => v.slug === vol);
            data = {
                volumes: filtered,
                total_volumes: filtered.length,
                total_parts: filtered.reduce((n, v) => n + v.parts.length, 0),
                total_chapters: filtered.reduce((n, v) => n + v.parts.reduce((m, p) => m + p.chapters.length, 0), 0),
            };
        }
        return toolText(envelope(data, sourceUrl));
    }
    catch (err) {
        return toolError(`get_policy_manual_toc failed: ${err.message}`);
    }
}
//# sourceMappingURL=get-policy-manual-toc.js.map