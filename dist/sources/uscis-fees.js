/**
 * USCIS filing fees, from Form G-1055 (the official Fee Schedule).
 *
 * Source: https://www.uscis.gov/sites/default/files/document/forms/g-1055.pdf
 * Auth:   none
 *
 * Why a PDF: the form pages themselves do not publish fees. Their "Filing Fee"
 * panel is a fixed 77-character pointer to the schedule, byte-identical across
 * every form. The page at /g-1055 carries no table either — the schedule
 * exists only as this PDF, 57 pages covering 99 forms.
 *
 * Why the verbatim block is returned alongside the parsed entries: a fee is the
 * one field where a wrong value gets a filing rejected, and most forms do not
 * have "a fee" — they have a fee per circumstance. Form I-485 lists 14 of them.
 * The parsed entries are a convenience; the block is the evidence, and
 * `edition_date` says which revision of the schedule it came from.
 */
import { PDFParse } from "pdf-parse";
import { httpGetBuffer } from "../lib/http.js";
import { cache, TTL } from "../lib/cache.js";
export const FEE_SCHEDULE_URL = "https://www.uscis.gov/sites/default/files/document/forms/g-1055.pdf";
/** A line that is nothing but a form number: the start of a block. */
const FORM_LINE = /^[A-Z]{1,3}-\d{1,4}[A-Z]{0,2}$/;
const AMOUNT = /\$[\d,]+(?:\.\d{2})?|\bVaries\b/i;
const FORM_URL = /\(uscis\.gov\/[^)]*\)/i;
/** Headers and footers repeated on all 57 pages. */
const FURNITURE = [
    /^--\s*\d+\s*of\s*\d+\s*--$/i,
    /^Form G-1055 Edition/i,
    /^Form Number and Title$/i,
    /^Filing Category$/i,
    /^Fee$/i,
    /^U\.S\. Citizenship and Immigration Services$/i,
    /^Department of Homeland Security$/i,
    /^USCIS$/i,
];
export async function getFormFees(formId) {
    const table = await getFeeTable();
    const key = normaliseFormId(formId);
    return { payload: table.get(key) ?? null, sourceUrl: FEE_SCHEDULE_URL };
}
/**
 * The whole schedule, parsed once. Cached for a day rather than a week: fees
 * are the most consequential field here to serve stale.
 */
async function getFeeTable() {
    const cacheKey = "uscis:fee-schedule";
    const cached = cache.get(cacheKey);
    if (cached)
        return new Map(cached);
    const { body, status } = await httpGetBuffer(FEE_SCHEDULE_URL);
    if (status >= 400) {
        throw new Error(`USCIS fee schedule returned HTTP ${status}.`);
    }
    const parser = new PDFParse({ data: body });
    try {
        const { text } = await parser.getText();
        const table = parseFeeSchedule(text);
        cache.set(cacheKey, [...table.entries()], TTL.ONE_DAY);
        return table;
    }
    finally {
        await parser.destroy();
    }
}
export function parseFeeSchedule(pdfText) {
    const edition = pdfText.match(/Form G-1055 Edition\s+([\d/]+)/i)?.[1];
    const lines = pdfText.split("\n").map((l) => l.trim());
    const starts = [];
    lines.forEach((l, i) => {
        if (FORM_LINE.test(l))
            starts.push(i);
    });
    const forms = new Map();
    for (let s = 0; s < starts.length; s++) {
        const id = lines[starts[s]];
        if (forms.has(id))
            continue; // first block wins
        const end = s + 1 < starts.length ? starts[s + 1] : lines.length;
        const block = lines
            .slice(starts[s] + 1, end)
            .filter((l) => l && !FURNITURE.some((f) => f.test(l)))
            .map(stripFurniture)
            .filter(Boolean);
        // The form URL closes the title but sits at the end of the last title line
        // rather than on its own — "14 (uscis.gov/i-485)".
        const urlIdx = block.findIndex((l) => FORM_URL.test(l));
        const form_title = urlIdx >= 0
            ? block
                .slice(0, urlIdx + 1)
                .join(" ")
                .replace(FORM_URL, "")
                .trim()
            : "";
        forms.set(id, {
            form_id: id,
            form_title,
            edition_date: edition,
            entries: parseEntries(urlIdx >= 0 ? block.slice(urlIdx + 1) : block),
            text: block.join("\n"),
        });
    }
    return forms;
}
function parseEntries(rows) {
    const entries = [];
    let condition = [];
    for (const line of rows) {
        // "General filing \t$0" — condition and amount share a line, tab-separated.
        const tab = line.split("\t");
        if (tab.length === 2 && AMOUNT.test(tab[1])) {
            entries.push({
                condition: [...condition, tab[0].trim()].filter(Boolean).join(" "),
                amounts: [tab[1].trim()],
            });
            condition = [];
            continue;
        }
        if (AMOUNT.test(line)) {
            const last = entries[entries.length - 1];
            const isOnline = /^Online Filing:/i.test(line);
            const hasPaper = last?.amounts.some((a) => /^Paper Filing:/i.test(a));
            const hasOnline = last?.amounts.some((a) => /^Online Filing:/i.test(a));
            // Paper and online are two halves of one fee, even when a continuation
            // clause ("plus additional fees, if applicable") sits between them.
            if (isOnline && last && hasPaper && !hasOnline) {
                last.amounts.push(line);
                if (condition.length) {
                    last.condition = `${last.condition} ${condition.join(" ")}`.trim();
                }
                condition = [];
                continue;
            }
            entries.push({ condition: condition.join(" "), amounts: [line] });
            condition = [];
            continue;
        }
        condition.push(line);
    }
    return entries;
}
function stripFurniture(line) {
    return (line
        .replace(/--\s*\d+\s*of\s*\d+\s*--/gi, " ")
        .replace(/Form G-1055 Edition\s*[\d/]*/gi, " ")
        .replace(/Form Number and Title/gi, " ")
        .replace(/\bFiling Category\b/gi, " ")
        // Collapse runs of spaces only: the tab separates condition from amount.
        .replace(/ {2,}/g, " ")
        .replace(/^ +| +$/g, ""));
}
/** "i 485", "I485" → "I-485" — the schedule keys blocks by the hyphenated id. */
function normaliseFormId(input) {
    return input
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "")
        .replace(/^([A-Z]{1,3})-?(\d)/, "$1-$2");
}
//# sourceMappingURL=uscis-fees.js.map