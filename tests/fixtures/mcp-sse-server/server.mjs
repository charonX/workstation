// Fixture：最小 MCP legacy SSE server（MCP SSE transport 子集，手写协议，不依赖 SDK）。
// 协议形态（对齐 legacy SSE transport）：
//   GET  /sse                     → text/event-stream；首发 `event: endpoint` + `data: /messages?sessionId=<id>`
//   POST /messages?sessionId=<id> → 202 Accepted；JSON-RPC 响应经 SSE 流 `event: message` 下发
//   其余方法/路径                 → 405（legacy-only：拒绝 streamable-http 的 POST 握手，
//                                    供 REQ-MCP-SSE-003 标准 2 证明探测端用的是 SSEClientTransport）
// 工具：echo（description 固定「回显输入文本（sse fixture）」），tools/call 回显参数。
//
// 环境变量：
//   MCP_FIXTURE_PORT      监听端口（默认 0 = 随机，启动后 stdout 打印 PORT=<n>）
//   MCP_FIXTURE_TOKEN     设置后要求 Authorization: Bearer <token>（GET /sse 与 POST /messages 均校验），否则 401
//   MCP_FIXTURE_AUTH_LOG  记录 GET /sse 收到的 Authorization 头（每次追加一行）

import http from "node:http";
import fs from "node:fs";
import crypto from "node:crypto";

const TOKEN = process.env.MCP_FIXTURE_TOKEN || null;
const AUTH_LOG = process.env.MCP_FIXTURE_AUTH_LOG || null;

/** sessionId → http.ServerResponse（SSE 流） */
const sessions = new Map();

function sseSend(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function handleRpc(msg, sessionRes) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    sseSend(sessionRes, "message", rpcResult(id, {
      protocolVersion: params?.protocolVersion ?? "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "fixture-mcp-sse", version: "0.0.1" },
    }));
    return;
  }
  if (method === "notifications/initialized") return;
  if (method === "tools/list") {
    sseSend(sessionRes, "message", rpcResult(id, {
      tools: [
        {
          name: "echo",
          description: "回显输入文本（sse fixture）",
          inputSchema: { type: "object", properties: { text: { type: "string" } } },
        },
      ],
    }));
    return;
  }
  if (method === "tools/call") {
    sseSend(sessionRes, "message", rpcResult(id, {
      content: [{ type: "text", text: `echo:${JSON.stringify(params?.arguments ?? {})}` }],
    }));
    return;
  }
  if (id !== undefined) {
    sseSend(sessionRes, "message", {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `method not found: ${method}` },
    });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (TOKEN && req.headers.authorization !== `Bearer ${TOKEN}`) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/sse") {
    if (AUTH_LOG) fs.appendFileSync(AUTH_LOG, String(req.headers.authorization ?? "") + "\n");
    const sessionId = crypto.randomUUID();
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    sessions.set(sessionId, res);
    res.write(`event: endpoint\ndata: /messages?sessionId=${sessionId}\n\n`);
    req.on("close", () => sessions.delete(sessionId));
    return;
  }

  if (req.method === "POST" && url.pathname === "/messages") {
    const sessionId = url.searchParams.get("sessionId");
    const sessionRes = sessions.get(sessionId);
    if (!sessionRes) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unknown session" }));
      return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let msg;
      try {
        msg = JSON.parse(body);
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "bad json" }));
        return;
      }
      res.writeHead(202, { "content-type": "text/plain" });
      res.end("Accepted");
      handleRpc(msg, sessionRes);
    });
    return;
  }

  // legacy-only：拒绝一切其他方法/路径（含 streamable-http 的 POST 握手）
  res.writeHead(405, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "method not allowed" }));
});

server.listen(Number(process.env.MCP_FIXTURE_PORT || 0), "127.0.0.1", () => {
  process.stdout.write(`PORT=${server.address().port}\n`);
});
