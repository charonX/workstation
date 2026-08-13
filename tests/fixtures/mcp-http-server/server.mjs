// Fixture：最小 MCP HTTP server（StreamableHTTP 子集，单端点 POST）。
// 支持 initialize / tools/list / tools/call，工具 fixture_ping 回显参数。
// 供 REQ-AGENT-085 标准 4（远程 server 全链路）。
//
// 环境变量：
//   MCP_FIXTURE_PORT      监听端口（默认 0 = 随机，启动后 stdout 打印 PORT=<n>）
//   MCP_FIXTURE_TOKEN     设置后要求 Authorization: Bearer <token>，否则 401
//   MCP_FIXTURE_CALL_LOG  tools/call 记录文件（追加一行 JSON/次）

import http from "node:http";
import fs from "node:fs";

const TOKEN = process.env.MCP_FIXTURE_TOKEN || null;
const CALL_LOG = process.env.MCP_FIXTURE_CALL_LOG || null;

function reply(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  if (TOKEN && req.headers.authorization !== `Bearer ${TOKEN}`) {
    return reply(res, 401, { error: "unauthorized" });
  }
  if (req.method !== "POST") return reply(res, 405, { error: "method not allowed" });
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let rpc;
    try {
      rpc = JSON.parse(body);
    } catch {
      return reply(res, 400, { error: "bad json" });
    }
    const { id, method, params } = rpc;
    if (method === "initialize") {
      return reply(res, 200, {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: params?.protocolVersion ?? "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "fixture-mcp-http", version: "0.0.1" },
        },
      });
    }
    if (method === "tools/list") {
      return reply(res, 200, {
        jsonrpc: "2.0",
        id,
        result: {
          tools: [
            {
              name: "fixture_ping",
              description: "echo back the input (test fixture)",
              inputSchema: { type: "object", properties: { text: { type: "string" } } },
            },
          ],
        },
      });
    }
    if (method === "tools/call") {
      if (CALL_LOG) fs.appendFileSync(CALL_LOG, JSON.stringify(params) + "\n");
      return reply(res, 200, {
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: `pong:${JSON.stringify(params?.arguments ?? {})}` }] },
      });
    }
    return reply(res, 200, { jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } });
  });
});

server.listen(Number(process.env.MCP_FIXTURE_PORT || 0), "127.0.0.1", () => {
  process.stdout.write(`PORT=${server.address().port}\n`);
});
