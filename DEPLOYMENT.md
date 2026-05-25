# Deployment & Configuration Guide

This guide covers running the USCIS MCP Server in real environments — from a developer laptop to a hardened remote service. It's organised by deployment scenario; jump to the section that matches your setup.

**Contents**

1. [Prerequisites](#1-prerequisites)
2. [Build & verify](#2-build--verify)
3. [Scenario A — Claude Desktop on your laptop (stdio)](#3-scenario-a--claude-desktop-on-your-laptop-stdio)
4. [Scenario B — HTTP server on your laptop (localhost only)](#4-scenario-b--http-server-on-your-laptop-localhost-only)
5. [Scenario C — HTTP server on a LAN or remote host](#5-scenario-c--http-server-on-a-lan-or-remote-host)
6. [Scenario D — Docker](#6-scenario-d--docker)
7. [Scenario E — systemd service (Linux)](#7-scenario-e--systemd-service-linux)
8. [Scenario F — Behind a reverse proxy (nginx / Caddy)](#8-scenario-f--behind-a-reverse-proxy-nginx--caddy)
9. [Configuration reference](#9-configuration-reference)
10. [Cache tuning](#10-cache-tuning)
11. [Observability](#11-observability)
12. [Updating the server](#12-updating-the-server)
13. [Troubleshooting](#13-troubleshooting)
14. [Security checklist](#14-security-checklist)

---

## 1. Prerequisites

| Requirement | Why |
|---|---|
| Node.js ≥ 18 | The MCP SDK and the server use modern ESM and `fetch`. Node 18 LTS is the minimum. Node 20 or 22 LTS is recommended. |
| `npm` (or `pnpm` / `yarn`) | For installing dependencies and running scripts. |
| Outbound internet on ports 80/443 | The server makes live calls to `www.ecfr.gov`, `www.uscis.gov`, and `immigrationtimes.org`. |
| ~150 MB free disk | For `node_modules` and the compiled `dist/`. |

Check your Node version:

```bash
node --version    # should print v18.x.x or higher
```

If you don't have Node, install via [nvm](https://github.com/nvm-sh/nvm), the official installer at [nodejs.org](https://nodejs.org), or your OS package manager.

## 2. Build & verify

These steps are the same for every scenario below.

```bash
# 1. Clone & enter the project
git clone <your-repo-url> uscis-mcp-server
cd uscis-mcp-server

# 2. Install dependencies
npm install

# 3. Compile TypeScript to dist/
npm run build

# 4. Verify the upstream endpoints actually work from your machine
npm run smoke
```

A successful smoke run looks like this:

```
── search_regulations ✓ ──
{ "data": { "total_count": 247, ... }, "source_url": "..." }

── get_visa_category_rules ✓ ──
{ "data": { "citation": "8 CFR 214.2", "text": "..." }, ... }

── get_form_requirements ✓ ──
{ "data": { "form_id": "I-130", "sections": { ... } }, ... }

── get_processing_time (list_options) ✓ ──
── get_processing_time (default) ✓ ──

══ 5/5 passed ══
```

If any test fails here, **fix it before deploying** — see [Troubleshooting](#13-troubleshooting).

## 3. Scenario A — Claude Desktop on your laptop (stdio)

This is the simplest setup and the most common. Claude Desktop spawns the server as a subprocess; you never run it manually.

### Step 1 — find your Claude config file

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

If the file doesn't exist, create it. If it exists and already has other servers, merge the entry below into the existing `mcpServers` object.

### Step 2 — add the server entry

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

**The path must be absolute.** `~/` and `$HOME` are not expanded.

On Windows, use forward slashes or double-escaped backslashes:

```json
{
  "mcpServers": {
    "uscis": {
      "command": "node",
      "args": ["C:/Users/Santiago/projects/uscis-mcp-server/dist/index.js"]
    }
  }
}
```

### Step 3 — restart Claude Desktop

Fully quit and relaunch. Within a few seconds you should see the four tools appear when you click the tool palette icon.

### Step 4 — sanity-check from inside Claude

Ask Claude:

> *"Use the USCIS tools to get the current processing time for an I-765."*

Claude should invoke `get_processing_time` and return a current estimate with a `source_url` pointing at `immigrationtimes.org`.

## 4. Scenario B — HTTP server on your laptop (localhost only)

Use this when:
- you want to share the server between multiple MCP clients without each one spawning a subprocess;
- you're integrating with a non-desktop client (a custom agent, an IDE plugin, a notebook);
- you want to inspect traffic for debugging.

### Run it

```bash
npm run start:http
```

You should see:

```
[uscis-mcp] HTTP transport listening on http://127.0.0.1:3030/mcp  (no auth)
```

The server now accepts MCP Streamable HTTP requests on `http://127.0.0.1:3030/mcp` and exposes a `/health` endpoint:

```bash
curl http://127.0.0.1:3030/health
# {"ok":true,"sessions":0,"uptime_seconds":12}
```

### Customise port

```bash
PORT=4040 npm run start:http
```

### Stop it

`Ctrl+C` in the terminal. Sessions are in-memory — they go with the process.

By default, requests are rejected unless the `Host` header is localhost. This is a [DNS-rebinding](https://en.wikipedia.org/wiki/DNS_rebinding) defence and matters even for localhost-only servers.

## 5. Scenario C — HTTP server on a LAN or remote host

Use this when the server lives on a different machine from the client — e.g. a home server, a VM, or a small VPS.

> **You must set `AUTH_TOKEN`** in this scenario. The server logs a warning if you don't, but the server will still happily serve unauthenticated requests if you ignore it.

### Generate a token

```bash
openssl rand -hex 32
# e.g. 4f2c8b7a91e6d3...  ← keep this secret
```

### Run with auth and broader bind

```bash
HOST=0.0.0.0 \
PORT=3030 \
AUTH_TOKEN=4f2c8b7a91e6d3... \
npm run start:http
```

### Verify

From another machine on the same network:

```bash
curl -H "Authorization: Bearer 4f2c8b7a91e6d3..." \
     http://<server-ip>:3030/health
```

Without the token, you should get `401 unauthorized`.

### MCP client config

Configure your MCP client with both the URL and the bearer token. The exact field names vary by client; in the SDK they look like:

```js
new StreamableHTTPClientTransport(new URL("http://server-ip:3030/mcp"), {
  requestInit: {
    headers: { Authorization: "Bearer 4f2c8b7a91e6d3..." },
  },
});
```

### Open the firewall

On most Linux hosts:

```bash
sudo ufw allow 3030/tcp
```

If the host is on the public internet, **do not** open port 3030 directly — see [Scenario F](#8-scenario-f--behind-a-reverse-proxy-nginx--caddy) to put it behind TLS.

## 6. Scenario D — Docker

A minimal `Dockerfile` you can drop into the project root:

```dockerfile
# Dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 3030
USER node
CMD ["node", "dist/http.js"]
```

Build and run:

```bash
docker build -t uscis-mcp .
docker run --rm -p 3030:3030 \
  -e HOST=0.0.0.0 \
  -e AUTH_TOKEN=$(openssl rand -hex 32) \
  uscis-mcp
```

Or with docker-compose (`docker-compose.yml`):

```yaml
services:
  uscis-mcp:
    build: .
    restart: unless-stopped
    ports:
      - "3030:3030"
    environment:
      HOST: 0.0.0.0
      PORT: 3030
      AUTH_TOKEN: ${AUTH_TOKEN}
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3030/health"]
      interval: 30s
      timeout: 5s
      retries: 3
```

Then:

```bash
export AUTH_TOKEN=$(openssl rand -hex 32)
docker compose up -d
```

**Notes**

- The Alpine base image keeps the final container around 150 MB.
- `USER node` drops out of root.
- Cache is in-process, so restarting the container clears it. That's fine — first requests after a restart will be a bit slower as caches re-warm.

## 7. Scenario E — systemd service (Linux)

For long-running deployments on a Linux host without Docker.

### Step 1 — create a dedicated user

```bash
sudo useradd --system --shell /bin/false --home-dir /opt/uscis-mcp uscis-mcp
sudo mkdir -p /opt/uscis-mcp
sudo chown uscis-mcp:uscis-mcp /opt/uscis-mcp
```

### Step 2 — install the code

Build on your dev machine or check out the repo into `/opt/uscis-mcp`:

```bash
sudo -u uscis-mcp git clone <repo-url> /opt/uscis-mcp
cd /opt/uscis-mcp
sudo -u uscis-mcp npm ci
sudo -u uscis-mcp npm run build
```

### Step 3 — create an environment file

```bash
sudo tee /etc/uscis-mcp.env > /dev/null <<EOF
HOST=127.0.0.1
PORT=3030
AUTH_TOKEN=$(openssl rand -hex 32)
NODE_ENV=production
EOF
sudo chmod 600 /etc/uscis-mcp.env
sudo chown uscis-mcp:uscis-mcp /etc/uscis-mcp.env
```

### Step 4 — write the unit file

`/etc/systemd/system/uscis-mcp.service`:

```ini
[Unit]
Description=USCIS MCP Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=uscis-mcp
Group=uscis-mcp
WorkingDirectory=/opt/uscis-mcp
EnvironmentFile=/etc/uscis-mcp.env
ExecStart=/usr/bin/node /opt/uscis-mcp/dist/http.js
Restart=on-failure
RestartSec=5s

# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_INET AF_INET6
RestrictNamespaces=true
LockPersonality=true
MemoryDenyWriteExecute=true

[Install]
WantedBy=multi-user.target
```

### Step 5 — enable and start

```bash
sudo systemctl daemon-reload
sudo systemctl enable uscis-mcp
sudo systemctl start uscis-mcp
sudo systemctl status uscis-mcp
```

### Step 6 — view logs

```bash
sudo journalctl -u uscis-mcp -f          # follow
sudo journalctl -u uscis-mcp --since today
```

## 8. Scenario F — Behind a reverse proxy (nginx / Caddy)

When you want TLS and a real hostname, put the server behind a proxy. The server itself stays on localhost.

### Caddy (simpler)

`/etc/caddy/Caddyfile`:

```
mcp.example.com {
    reverse_proxy 127.0.0.1:3030 {
        # Streamable HTTP needs longer timeouts than vanilla HTTP — SSE
        # streams can stay open for the lifetime of a session.
        transport http {
            read_timeout 1h
            write_timeout 1h
        }
    }
}
```

Reload:

```bash
sudo systemctl reload caddy
```

Caddy automatically issues and renews a Let's Encrypt certificate.

### nginx

`/etc/nginx/sites-available/uscis-mcp`:

```nginx
server {
    listen 443 ssl http2;
    server_name mcp.example.com;

    ssl_certificate     /etc/letsencrypt/live/mcp.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mcp.example.com/privkey.pem;

    location /mcp {
        proxy_pass         http://127.0.0.1:3030/mcp;
        proxy_http_version 1.1;

        # SSE / Streamable HTTP needs these
        proxy_set_header   Connection "";
        proxy_buffering    off;
        proxy_cache        off;
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;

        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }

    location /health {
        proxy_pass http://127.0.0.1:3030/health;
    }
}
```

> **Critical:** `proxy_buffering off` is required. The Streamable HTTP transport uses SSE for some responses, and buffered proxying breaks SSE.

Test and reload:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

When proxied, set `HOST=127.0.0.1` on the upstream and rely on the proxy for TLS + auth gateway. You can still set `AUTH_TOKEN` for defence-in-depth.

## 9. Configuration reference

| Variable | Default | Scope | Notes |
|---|---|---|---|
| `PORT` | `3030` | HTTP only | Listen port |
| `HOST` | `127.0.0.1` | HTTP only | Bind address. `0.0.0.0` exposes to all interfaces. |
| `AUTH_TOKEN` | _(unset)_ | HTTP only | Bearer token required on `Authorization` header if set |
| `NODE_ENV` | _(unset)_ | Both | Set to `production` in deployments to silence dev warnings |

Cache TTLs are baked in. To change them, edit `src/lib/cache.ts` and rebuild.

## 10. Cache tuning

The default TTLs match the cadence of the underlying data sources:

| Tool | TTL | Why |
|---|---|---|
| `search_regulations` | 6 hours | eCFR updates continuously but rarely multiple times a day |
| `get_visa_category_rules` | 6 hours | Same |
| `get_form_requirements` | 7 days | USCIS form pages change rarely; instructions are versioned by edition |
| `get_processing_time` | 24 hours | USCIS publishes ~monthly, around the 15th — 24h ensures same-day freshness |

If you want to change them, edit `src/lib/cache.ts`:

```ts
export const TTL = {
  SIX_HOURS: 6 * 60 * 60 * 1000,
  ONE_DAY: 24 * 60 * 60 * 1000,
  SEVEN_DAYS: 7 * 24 * 60 * 60 * 1000,
} as const;
```

Then rebuild: `npm run build`.

The cache is in-memory. If you run multiple instances behind a load balancer (rare for this workload), each will maintain its own cache. For Redis support, see the v1.1 roadmap in the spec.

## 11. Observability

### Health endpoint

```bash
curl http://127.0.0.1:3030/health
```

Returns:

```json
{
  "ok": true,
  "sessions": 3,
  "uptime_seconds": 84120
}
```

Use this for liveness probes (Kubernetes, Docker `healthcheck`, monitoring agents).

### Logs

The HTTP server logs to stdout. Under systemd, `journalctl -u uscis-mcp` captures everything. Under Docker, `docker logs <container>`.

The stdio server logs to stderr only (stdout is the MCP wire). Claude Desktop captures this in its own log directory:

| OS | Path |
|---|---|
| macOS | `~/Library/Logs/Claude/mcp-server-uscis.log` |
| Windows | `%APPDATA%\Claude\logs\mcp-server-uscis.log` |

### Verifying upstream sources

If results look stale or suspicious, hit the upstream directly:

```bash
# eCFR
curl 'https://www.ecfr.gov/api/search/v1/results?query=H-1B&hierarchy%5Btitle%5D=8&per_page=3'

# USCIS form page
curl -s https://www.uscis.gov/i-130 | head -50

# Processing times
curl 'https://immigrationtimes.org/api/v1/forms'
```

Every tool response includes `source_url` — copy it into curl to reproduce.

## 12. Updating the server

```bash
cd uscis-mcp-server
git pull
npm install
npm run build

# For systemd:
sudo systemctl restart uscis-mcp

# For Docker:
docker compose build && docker compose up -d

# For Claude Desktop:
# fully quit and relaunch Claude Desktop
```

After any update, run `npm run smoke` to confirm upstreams still behave as expected. If USCIS has reshuffled their endpoints, this is where you'll find out.

## 13. Troubleshooting

### "Cannot find module 'dist/index.js'"

You skipped `npm run build`. Run it.

### "HTTP 403: Host not in allowlist" in smoke test

Your machine can't reach the USCIS or eCFR domains. Common causes:
- Corporate firewall blocking outbound HTTPS
- VPN that proxies everything through a filtering gateway
- DNS resolution failure

Test directly:

```bash
curl -v https://www.ecfr.gov/api/search/v1/results?query=test
curl -v https://immigrationtimes.org/api/v1/forms
```

### Claude Desktop doesn't show the tools

1. Confirm the path in `claude_desktop_config.json` is absolute.
2. Confirm `dist/index.js` exists (`npm run build`).
3. Fully quit Claude Desktop — closing the window isn't enough on macOS.
4. Check the MCP log file (paths above) for startup errors.

A common issue is that the user clicked away from the config tab but the file was never saved. Re-open it and verify the JSON is valid (`jq < claude_desktop_config.json`).

### HTTP server returns 401 unauthorized

You set `AUTH_TOKEN` but your client isn't sending it. Verify with:

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" http://127.0.0.1:3030/health
```

### HTTP server returns 403 forbidden_host

DNS-rebinding protection. You're either:
- hitting the server with a non-localhost `Host` header while it's bound to localhost; or
- behind a reverse proxy that isn't forwarding the right `Host`.

Fix by either binding to `0.0.0.0` (with `AUTH_TOKEN`!) or by setting the proxy to send `Host: localhost`.

### Processing-time queries return empty results

immigrationtimes.org may have changed its API shape. Check the raw upstream response:

```bash
curl 'https://immigrationtimes.org/api/v1/formtypes/I-485'
```

If the structure looks different from what the code in `src/sources/immigrationtimes.ts` expects, you'll need a small patch to the response-handling section. Open an issue with the curl output attached.

### Form requirements come back sparse or empty

USCIS.gov may have re-structured its form pages. `src/sources/uscis-forms.ts` uses heading-based heuristics to find sections; adding a new alias to `SECTION_ALIASES` is usually enough to recover.

### Cache stays warm with stale data

Restart the process. The cache is in-memory; nothing to flush.

## 14. Security checklist

For any deployment beyond your own laptop, work through this list:

- [ ] **AUTH_TOKEN set** to a value with ≥128 bits of entropy (e.g., `openssl rand -hex 32`).
- [ ] **HOST=0.0.0.0 only when intentional.** Default to `127.0.0.1` and use a reverse proxy.
- [ ] **TLS in front** of any non-localhost deployment (Caddy auto, nginx + certbot, or your load balancer).
- [ ] **Dedicated OS user** (not root) running the process.
- [ ] **Firewall** restricting inbound to the exact port from the exact source IPs you expect.
- [ ] **Logs rotated** (journald default is fine; Docker users — add a `logging` driver with size limits).
- [ ] **Updates monitored.** USCIS and eCFR are external — the server is fragile to their changes. Subscribe to your own monitoring or check `npm run smoke` weekly.
- [ ] **The data is public, the tool is unofficial.** Be transparent with end users about what this server is and isn't.

---

*This guide covers v1.0 of the server. For architecture, data flow diagrams, and v1.1 / v1.2 roadmap, see the [Technical Specification PDF](./USCIS_MCP_Server_Spec.pdf).*
