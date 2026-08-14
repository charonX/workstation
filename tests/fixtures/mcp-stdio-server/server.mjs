// Fixture：最小 MCP stdio server（换行分隔 JSON-RPC，MCP 协议子集）。
// 支持 initialize / tools/list / tools/call，工具 fixture_ping 回显参数。
// 供 REQ-AGENT-085 桥全链路 / REQ-AGENT-086 权限裁决断言「server 是否收到调用」。
//
// 记录收到的 tools/call 到环境变量 MCP_FIXTURE_CALL_LOG 指定的文件（每次追加一行 JSON）。

import readline from "node:readline";
import fs from "node:fs";

const CALL_LOG = process.env.MCP_FIXTURE_CALL_LOG || null;

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function recordCall(params) {
  if (CALL_LOG) fs.appendFileSync(CALL_LOG, JSON.stringify(params) + "\n");
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = req;
  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "fixture-mcp-stdio", version: "0.0.1" },
      },
    });
    return;
  }
  if (method === "notifications/initialized") return;
  if (method === "tools/list") {
    send({
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
    return;
  }
  if (method === "tools/call") {
    recordCall(params);
    send({
      jsonrpc: "2.0",
      id,
      result: {
        content: [{ type: "text", text: `pong:${JSON.stringify(params?.arguments ?? {})}` }],
      },
    });
    return;
  }
  if (id !== undefined) {
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } });
  }
});
