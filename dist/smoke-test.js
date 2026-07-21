/**
 * Smoke test — exercises every handler directly (no MCP transport involved).
 *
 * Run with:  npm run build && npm run smoke
 *
 * Hits live USCIS / eCFR endpoints — needs internet.
 */
import { searchRegulationsHandler } from "./tools/search-regulations.js";
import { getVisaCategoryRulesHandler } from "./tools/get-visa-category-rules.js";
import { getFormRequirementsHandler } from "./tools/get-form-requirements.js";
import { getProcessingTimeHandler } from "./tools/get-processing-time.js";
import { getPolicyManualTocHandler } from "./tools/get-policy-manual-toc.js";
import { getPolicyManualSectionHandler } from "./tools/get-policy-manual-section.js";
import { searchBiaDecisionsHandler } from "./tools/search-bia-decisions.js";
import { getBiaDecisionHandler } from "./tools/get-bia-decision.js";
function summarise(label, result) {
    const ok = !result.isError;
    const head = result.content?.[0]?.text?.slice(0, 300) ?? "";
    console.log(`\n── ${label} ${ok ? "✓" : "✗"} ──`);
    console.log(head + (head.length >= 300 ? "…" : ""));
    return ok;
}
async function main() {
    const results = [];
    results.push(summarise("search_regulations", (await searchRegulationsHandler({
        query: "H-1B specialty occupation",
        max_results: 3,
    }))));
    results.push(summarise("get_visa_category_rules", (await getVisaCategoryRulesHandler({
        citation: "8 CFR 214.2",
    }))));
    results.push(summarise("get_form_requirements", (await getFormRequirementsHandler({ form_id: "I-130" }))));
    results.push(summarise("get_processing_time (list_options)", (await getProcessingTimeHandler({
        form_id: "I-765",
        list_options: true,
    }))));
    results.push(summarise("get_processing_time (default)", (await getProcessingTimeHandler({ form_id: "I-765" }))));
    results.push(summarise("get_policy_manual_toc", (await getPolicyManualTocHandler({}))));
    results.push(summarise("get_policy_manual_section", (await getPolicyManualSectionHandler({
        slug: "volume-1-part-a-chapter-1",
    }))));
    results.push(summarise("search_bia_decisions", (await searchBiaDecisionsHandler({
        query: "crime involving moral turpitude",
        max_results: 3,
    }))));
    results.push(summarise("get_bia_decision (by citation)", (await getBiaDecisionHandler({
        citation: "28 I&N Dec. 883",
    }))));
    const passed = results.filter(Boolean).length;
    console.log(`\n══ ${passed}/${results.length} passed ══`);
    process.exit(passed === results.length ? 0 : 1);
}
main().catch((err) => {
    console.error("smoke-test crashed:", err);
    process.exit(1);
});
//# sourceMappingURL=smoke-test.js.map