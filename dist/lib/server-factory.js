/**
 * Server factory.
 *
 * Both the stdio entry point (index.ts) and the HTTP entry point (http.ts)
 * build their Server instance from this single source of truth. Each
 * incoming HTTP session gets its own Server instance — that's how the
 * Streamable HTTP transport is designed to be used.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { searchRegulationsSchema, searchRegulationsHandler, } from "../tools/search-regulations.js";
import { getVisaCategoryRulesSchema, getVisaCategoryRulesHandler, } from "../tools/get-visa-category-rules.js";
import { getFormRequirementsSchema, getFormRequirementsHandler, } from "../tools/get-form-requirements.js";
import { getProcessingTimeSchema, getProcessingTimeHandler, } from "../tools/get-processing-time.js";
import { getPolicyManualTocSchema, getPolicyManualTocHandler, } from "../tools/get-policy-manual-toc.js";
import { getPolicyManualSectionSchema, getPolicyManualSectionHandler, } from "../tools/get-policy-manual-section.js";
const TOOLS = [
    searchRegulationsSchema,
    getVisaCategoryRulesSchema,
    getFormRequirementsSchema,
    getProcessingTimeSchema,
    getPolicyManualTocSchema,
    getPolicyManualSectionSchema,
];
const HANDLERS = {
    search_regulations: searchRegulationsHandler,
    get_visa_category_rules: getVisaCategoryRulesHandler,
    get_form_requirements: getFormRequirementsHandler,
    get_processing_time: getProcessingTimeHandler,
    get_policy_manual_toc: getPolicyManualTocHandler,
    get_policy_manual_section: getPolicyManualSectionHandler,
};
export function createServer() {
    const server = new Server({
        name: "uscis-mcp-server",
        version: "1.0.0",
    }, {
        capabilities: { tools: {} },
    });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: TOOLS,
    }));
    server.setRequestHandler(CallToolRequestSchema, async (req) => {
        const name = req.params.name;
        const args = req.params.arguments ?? {};
        const handler = HANDLERS[name];
        if (!handler) {
            return {
                isError: true,
                content: [{ type: "text", text: `Unknown tool: ${name}` }],
            };
        }
        return await handler(args);
    });
    return server;
}
//# sourceMappingURL=server-factory.js.map