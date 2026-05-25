export function envelope(data, sourceUrl, opts = {}) {
    return {
        data,
        source_url: sourceUrl,
        fetched_at: new Date().toISOString(),
        ...(opts.stale ? { stale: true } : {}),
        ...(opts.staleReason ? { stale_reason: opts.staleReason } : {}),
        ...(opts.ageSeconds !== undefined ? { age_seconds: opts.ageSeconds } : {}),
    };
}
/** Convenience: wrap any object into the MCP tool result shape. */
export function toolText(payload) {
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(payload, null, 2),
            },
        ],
    };
}
export function toolError(message) {
    return {
        isError: true,
        content: [{ type: "text", text: message }],
    };
}
//# sourceMappingURL=envelope.js.map