# USCIS MCP Server

A self-hosted [Model Context Protocol](https://modelcontextprotocol.io) server that gives Claude — or any MCP-compatible client — live access to USCIS regulations, form documentation requirements, and processing-time estimates pulled directly from US government sources.

[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/typescript-5.5-blue.svg)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-MIT-orange.svg)](#license)

---

## What it does

Plugs into Claude and exposes four tools so the model can answer immigration questions with current, citable data instead of stale training data:

| Tool | Purpose | Source |
|---|---|---|
| `search_regulations` | Full-text search of Title 8 CFR (Aliens and Nationality) | [eCFR API](https://www.ecfr.gov) |
| `get_visa_category_rules` | Full regulatory text by citation (e.g. `8 CFR 214.2(h)`) | eCFR versioner |
| `get_form_requirements` | "What to file" / "Where to file" / fees for any USCIS form | [USCIS.gov](https://www.uscis.gov) |
| `get_processing_time` | Current monthly processing estimates by form + office | [egov.uscis.gov](https://egov.uscis.gov/processing-times) |

Every response is wrapped in an envelope containing `source_url` and `fetched_at` so consumers can verify provenance.

## Why self-host

- **No API key.** All upstream sources are public.
- **Runs entirely on your machine.** No data leaves your network except the calls to USCIS / eCFR themselves.
- **Two transports.** Use stdio for Claude Desktop or Streamable HTTP for remote clients. Same tools, your choice.
- **Cached.** Each upstream is hit only as often as makes sense — daily for processing times, weekly for form pages, hourly for search queries.

## Quick start

```bash
git clone <this-repo>
cd uscis-mcp-server
npm install
npm run build

# Verify it works against live USCIS endpoints
npm run smoke
```

That's it. Pick your transport below.

### For Claude Desktop (stdio)

Add to your `claude_desktop_config.json`:

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

```json
{
  "mcpServers": {
    "uscis": {
      "command": "node",
      "args": ["/absolute/path/to/uscis-mcp-server/dist/index.js"]
    }
  }
}
```

Restart Claude Desktop. The four tools appear in the tool palette automatically.

### For remote clients (HTTP)

```bash
npm run start:http
# [uscis-mcp] HTTP transport listening on http://127.0.0.1:3030/mcp  (no auth)
```

Point any [Streamable HTTP](https://modelcontextprotocol.io) MCP client at `http://127.0.0.1:3030/mcp`.

See [DEPLOYMENT.md](./DEPLOYMENT.md) for production setup — systemd, Docker, reverse proxy, hardening, monitoring.

## Configuration

All knobs are environment variables. The HTTP transport reads them at startup; the stdio transport ignores them (there's nothing to tune on a subprocess).

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3030` | Port the HTTP transport binds to |
| `HOST` | `127.0.0.1` | Bind address. Use `0.0.0.0` for LAN/remote exposure. |
| `AUTH_TOKEN` | _(unset)_ | If set, clients must send `Authorization: Bearer <token>` |

Cache TTLs live in `src/lib/cache.ts` and require a rebuild to change.

## Response envelope

Every tool returns JSON of this shape:

```json
{
  "data": { /* tool-specific payload */ },
  "source_url": "https://www.ecfr.gov/api/...",
  "fetched_at": "2026-05-20T14:23:01.234Z"
}
```

When the upstream is unreachable and a cached value is returned, the envelope adds:

```json
{
  "stale": true,
  "stale_reason": "upstream_unavailable: HTTP 503",
  "age_seconds": 86400
}
```

This means the LLM can reason about staleness rather than blindly trusting the data.

## Example queries

Once connected to Claude, you can ask:

> *"What does 8 CFR 214.2(h) say about H-1B specialty occupation requirements?"*
> → calls `get_visa_category_rules`

> *"What documents do I need to file an I-130 for my spouse?"*
> → calls `get_form_requirements`

> *"How long is USCIS currently taking to process an I-485 application?"*
> → calls `get_processing_time`

> *"Find regulations about adjustment of status eligibility."*
> → calls `search_regulations`

## Project layout

```
src/
  index.ts                 # stdio entry point (Claude Desktop)
  http.ts                  # Streamable HTTP entry point (remote clients)
  smoke-test.ts            # Direct-call test harness
  lib/
    server-factory.ts      # Builds a Server with all tools registered
    cache.ts               # TTL cache + stale fallback
    envelope.ts            # Response envelope helpers
    http.ts                # fetch wrapper with retries + backoff
  sources/
    ecfr.ts                # eCFR search + section retrieval
    egov.ts                # USCIS processing-times API client
    uscis-forms.ts         # USCIS.gov form-page scraper (cheerio)
  tools/
    search-regulations.ts
    get-visa-category-rules.ts
    get-form-requirements.ts
    get-processing-time.ts
```

## Caveats

1. **The egov processing-times API is undocumented.** USCIS may change its shape without notice. The connector handles two known response variants, but break-fix may be needed if they ship a third.
2. **USCIS.gov page structure can drift.** The form-requirements scraper uses heading-based heuristics. If a major redesign ships, you'll get sparser results until selectors are updated — the source URL is always included so the LLM can fall back to fetching the page itself.
3. **Regulations are extremely volatile in 2026.** Always trust `source_url` and `fetched_at` over an LLM's training-data recollection.
4. **Not affiliated with USCIS.** This is an unofficial wrapper around public endpoints. Do not rely on it for legal decisions.

## Development

```bash
npm run dev          # tsc --watch
npm run clean        # remove dist/
npm run smoke        # hit every tool against live endpoints
```

## License

MIT
