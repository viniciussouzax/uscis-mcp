#!/usr/bin/env node
/**
 * USCIS MCP Server — HTTP entry point (Streamable HTTP transport).
 *
 * For remote MCP clients. The same tools, same business logic — only the
 * transport is different. Run this when you want the server to be reachable
 * over the network from another machine (or another process on the same
 * machine that isn't going to spawn it as a subprocess).
 *
 * Protocol: MCP Streamable HTTP (the post-2025-03 successor to plain SSE).
 *   POST   /mcp   — client→server JSON-RPC; can optionally open an SSE
 *                   response stream when the server has progress/notifications
 *                   to push back during a single request.
 *   GET    /mcp   — opens a server→client SSE stream for the session.
 *   DELETE /mcp   — closes the session.
 *
 * Sessions are tracked by the `mcp-session-id` header, which the server mints
 * on the initialize request and the client must echo on every subsequent call.
 *
 * Run:
 *   $ npm run build && npm run start:http
 *
 * Env vars:
 *   PORT          — listen port (default 3030)
 *   HOST          — bind address (default 127.0.0.1; set to 0.0.0.0 for LAN)
 *   AUTH_TOKEN    — if set, requests must include `Authorization: Bearer <token>`
 *
 * Security note: by default we bind to localhost ONLY and reject Host headers
 * that don't match localhost. That blocks DNS-rebinding attacks. If you need
 * to expose the server beyond your own machine, set HOST=0.0.0.0 AND set
 * AUTH_TOKEN to something hard to guess.
 */
import express, { type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "./lib/server-factory.js";

const PORT = Number(process.env.PORT ?? 3030);
const HOST = process.env.HOST ?? "127.0.0.1";
const AUTH_TOKEN = process.env.AUTH_TOKEN; // optional bearer token

const SESSION_HEADER = "mcp-session-id";

// Per-session transport storage. Each MCP session has one transport+server.
interface SessionEntry {
  transport: StreamableHTTPServerTransport;
}
const sessions = new Map<string, SessionEntry>();

const app = express();
app.use(express.json({ limit: "1mb" }));

// ── Auth + DNS rebinding protection ─────────────────────────────────────────
app.use((req, res, next) => {
  // Bearer token check (only if AUTH_TOKEN is set)
  if (AUTH_TOKEN) {
    const auth = req.header("authorization") ?? "";
    if (auth !== `Bearer ${AUTH_TOKEN}`) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
  }

  // DNS rebinding protection: only allow Host headers we recognise.
  // Default policy when bound to localhost: require localhost in Host.
  if (HOST === "127.0.0.1" || HOST === "localhost") {
    const host = (req.header("host") ?? "").toLowerCase();
    const ok =
      host.startsWith("localhost") ||
      host.startsWith("127.0.0.1") ||
      host.startsWith("[::1]");
    if (!ok) {
      res.status(403).json({ error: "forbidden_host" });
      return;
    }
  }
  next();
});

// ── Health check (no MCP) ────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    sessions: sessions.size,
    uptime_seconds: Math.floor(process.uptime()),
  });
});

// ── MCP endpoint ────────────────────────────────────────────────────────────
//
// One handler covers POST, GET, and DELETE. The transport object knows how
// to interpret each verb — we just route the raw req/res into it.

async function handleMcp(req: Request, res: Response) {
  const sessionId = req.header(SESSION_HEADER);
  let entry = sessionId ? sessions.get(sessionId) : undefined;

  // New session: only legal on a POST that contains an `initialize` request.
  if (!entry) {
    if (req.method !== "POST") {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "session not initialized" },
        id: null,
      });
      return;
    }
    if (!isInitializeRequest(req.body)) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "first request must be initialize",
        },
        id: null,
      });
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, { transport });
      },
    });

    transport.onclose = () => {
      if (transport.sessionId) {
        sessions.delete(transport.sessionId);
      }
    };

    const server = createServer();
    await server.connect(transport);

    await transport.handleRequest(req, res, req.body);
    return;
  }

  // Existing session — let the transport handle the verb.
  await entry.transport.handleRequest(req, res, req.body);
}

app.post("/mcp", handleMcp);
app.get("/mcp", handleMcp);
app.delete("/mcp", handleMcp);

// ── Boot ────────────────────────────────────────────────────────────────────
app.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[uscis-mcp] HTTP transport listening on http://${HOST}:${PORT}/mcp` +
      (AUTH_TOKEN ? "  (bearer auth enabled)" : "  (no auth)"),
  );
  if (HOST === "0.0.0.0" && !AUTH_TOKEN) {
    console.warn(
      "[uscis-mcp] WARNING: bound to 0.0.0.0 without AUTH_TOKEN — the server is reachable from anywhere on your network without authentication.",
    );
  }
});
