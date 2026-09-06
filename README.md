# USCIS MCP Server

A self-hosted [Model Context Protocol](https://modelcontextprotocol.io) server that gives Claude — or any MCP-compatible client — live access to USCIS regulations, form documentation requirements, processing-time estimates, the full USCIS Policy Manual, and precedential Board of Immigration Appeals decisions.

[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/typescript-5.5-blue.svg)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-MIT-orange.svg)](#license)

> **Disclaimer — prototype, no warranty.** This project is a prototype intended to facilitate access to federal information sources for lawyers, advocates, researchers, and others. It is provided as-is, with **no warranty of reliability**, accuracy, or fitness for any purpose. Always verify every authority at its official source before relying on it. Requests for additional functionality should be submitted as [issues on GitHub](https://github.com/sgarcese/uscis-mcp/issues).

---

## What it does

Plugs into Claude and exposes eight tools so the model can answer immigration questions with current, citable data instead of stale training data:

| Tool | Purpose | Source |
|---|---|---|
| `search_regulations` | Full-text search of Title 8 CFR (Aliens and Nationality) | [eCFR API](https://www.ecfr.gov) |
| `get_visa_category_rules` | Full regulatory text by citation (e.g. `8 CFR 214.2(h)`) | eCFR versioner |
| `get_form_requirements` | Checklist of required initial evidence, where/when to file, filing tips, special instructions and filing fees for any USCIS form | [USCIS.gov](https://www.uscis.gov) + [G-1055 Fee Schedule](https://www.uscis.gov/g-1055) |
| `get_processing_time` | Current monthly processing estimates by form + office | [immigrationtimes.org](https://immigrationtimes.org) |
| `get_policy_manual_toc` | Full volume → part → chapter hierarchy of the USCIS Policy Manual | [USCIS Policy Manual](https://www.uscis.gov/policy-manual) |
| `get_policy_manual_section` | Policy text for any volume, part, or chapter by slug | [USCIS Policy Manual](https://www.uscis.gov/policy-manual) |
| `search_bia_decisions` | Search ~3,150 precedential BIA / Attorney General decisions (I&N Dec. vols. 8–present, 1955–) by case name, citation, or holding | [DOJ EOIR](https://www.justice.gov/eoir/ag-bia-decisions) |
| `get_bia_decision` | Full text of any precedential decision, extracted from the official PDF | [DOJ EOIR](https://www.justice.gov/eoir/ag-bia-decisions) |

Every response is wrapped in an envelope containing `source_url` and `fetched_at` so consumers can verify provenance.

## Why self-host

- **No API key.** All upstream sources are public.
- **Runs entirely on your machine.** No data leaves your network except the calls to USCIS / eCFR themselves.
- **Two transports.** Use stdio for Claude Desktop or Streamable HTTP for remote clients. Same tools, your choice.
- **Cached.** Each upstream is hit only as often as makes sense — daily for processing times, weekly for form pages, policy manual pages, and BIA volume indexes, every six hours for regulation searches.

## Quick start

```bash
git clone https://github.com/sgarcese/uscis-mcp
cd uscis-mcp
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
      "args": ["/absolute/path/to/uscis-mcp/dist/index.js"]
    }
  }
}
```

Restart Claude Desktop. The eight tools appear in the tool palette automatically.

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

> *"What does USCIS policy say about H-1B specialty occupation determinations?"*
> → calls `get_policy_manual_toc`, then `get_policy_manual_section`

> *"Show me the USCIS Policy Manual chapter on naturalization eligibility."*
> → calls `get_policy_manual_section`

> *"Find BIA precedent on what counts as a crime involving moral turpitude."*
> → calls `search_bia_decisions`

> *"Give me the full text of Matter of Silva-Trevino, 26 I&N Dec. 550."*
> → calls `get_bia_decision`

## Companion skill: attorney research

[`skills/uscis-attorney-research/`](./skills/uscis-attorney-research/) contains an Agent Skill that layers structured legal-research workflows on top of these tools — RFE/NOID response research, intake and case-strategy screening, precedent research for motions, appeals, and removal defense, policy verification, and pre-filing QA — each with citation-integrity ground rules and a bundled reference on the I-290B motion/appeal framework. Install it alongside the server in any client that supports Agent Skills.

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
    uscis-fees.ts          # G-1055 Fee Schedule PDF parser
    egov.ts                # Official egov.uscis.gov processing-times client (dormant: WAF-blocked, see Caveats)
    eoir.ts                # DOJ EOIR precedential decision scraper + PDF text extraction
    immigrationtimes.ts    # immigrationtimes.org processing-times client
    policy-manual.ts       # USCIS Policy Manual TOC + chapter scraper
    uscis-forms.ts         # USCIS.gov form-page scraper (cheerio)
  tools/
    search-regulations.ts
    get-visa-category-rules.ts
    get-form-requirements.ts
    get-processing-time.ts
    get-policy-manual-toc.ts
    get-policy-manual-section.ts
    search-bia-decisions.ts
    get-bia-decision.ts
```

## Caveats

1. **Processing times come from an unofficial source, and there is no official one available.** [immigrationtimes.org](https://immigrationtimes.org) aggregates USCIS data but is not operated by the government. If it goes down or changes its API shape, processing-time queries will fail until the source is updated. USCIS's own endpoint at `egov.uscis.gov` sits behind a Cloudflare WAF that rejects non-browser clients — see below — and USCIS's official [Torch developer platform](https://developer.uscis.gov) publishes only a Case Status API and a FOIA API, with no processing-times API as of September 2026. So treat these numbers as indicative, not as a government figure.

   `src/sources/egov.ts` is the dormant client for the official endpoint. It is kept for reference and is imported by nothing. The block is not about IP reputation: from a single IP, Node's `fetch` and `curl` with Chrome headers both get an identical `403 Sorry, you have been blocked`, while a real browser gets an interactive challenge instead. What separates them is the TLS fingerprint (JA3), which a proxy does not change — so residential or rotating proxies would not revive this client. **This project does not attempt to defeat that control**, and the file stays dormant deliberately rather than for lack of a technique.
2. **Filing fees come from the G-1055 schedule, and are conditional.** The form pages do not publish fees — their "Filing Fee" panel is a fixed 77-character pointer, byte-identical across all 20 forms sampled — so `filing_fee` is read from the official [G-1055 Fee Schedule](https://www.uscis.gov/g-1055) PDF instead. Most forms do not have *a* fee: they have one per circumstance (Form I-485 lists 14; I-765 and I-129 say only "Varies"). Every response carries the schedule's `edition_date`, the parsed `entries`, and the form's block of the schedule verbatim so an amount can be checked against its condition. Never quote a fee without the condition it belongs to — a wrong fee gets the filing rejected.
3. **USCIS.gov page structure can drift.** Both the form-requirements and policy manual scrapers use CSS class selectors. If USCIS redesigns their Drupal templates, selectors may need updating — the `source_url` is always included so the LLM can fall back to fetching the page directly.
4. **The Policy Manual is administrative guidance, not regulation.** It reflects USCIS officer practice but can be updated or rescinded without notice. Always cross-reference with the CFR via `get_visa_category_rules`.
5. **Regulations are extremely volatile in 2026.** Always trust `source_url` and `fetched_at` over an LLM's training-data recollection.
6. **Only precedential BIA decisions are covered.** DOJ does not systematically publish non-precedential ("unpublished") decisions, so `search_bia_decisions` cannot see them. Holding summaries are only published for volume 19 (1985) onward; earlier decisions are still searchable by case name and citation, and their full text is always retrievable. Decision text is extracted from PDFs and capped at 40,000 characters (a `truncated` flag and the official PDF URL are always included).
7. **Not affiliated with USCIS or DOJ.** This is an unofficial wrapper around public endpoints. Do not rely on it for legal decisions.

## Development

```bash
npm run dev          # tsc --watch
npm run clean        # remove dist/
npm run smoke        # hit every tool against live endpoints
```

## License

MIT — see [LICENSE](./LICENSE).
