// REQ-TRACE: 2026-08-12-pi-mcp-plugin/REQ-AGENT-090
// REQ-VERSION: v1-hash:6c7fd998525a697ef21587c808800edfb15182b428d588f83c9ae835acf09243
// CAPABILITY-TRACE: command-interface
// ENTITY-TRACE: cli
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-08-13 assertion signoff)

// 插件/MCP CLI 命令族（REQ-090；ADR-001 CLI/HTTP 共享服务层，CLI 即测试 seam）。
//
// 已签命令面（门 1，2026-08-13，D5）：
//   opc-workstation plugin add <source>
//   opc-workstation plugin remove <source>
//   opc-workstation plugin list [--project <id>]
//   opc-workstation plugin enable|disable <name> --project <id>
//   opc-workstation mcp add <name> --type stdio --command <cmd> [--args a,b] [--env K=V]…
//   opc-workstation mcp add <name> --type http --url <u> [--header K=V]… [--auth none|bearer|oauth]
//   opc-workstation mcp list
//   opc-workstation mcp enable|disable <name> --project <id>
//   stdout 均为 JSON；业务错误非零退出 + stderr 含「格式不正确」或错误码。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../../../../../");
const CLI = ["node", [path.join(ROOT, "src/cli/opc-workstation.js")]];
const GOOD_EXT = path.join(ROOT, "tests/fixtures/pi-extension-good");
const STDIO_SERVER = path.join(ROOT, "tests/fixtures/mcp-stdio-server/server.mjs");

function cli(args, options = {}) {
  return execFileSync(CLI[0], [...CLI[1], ...args], { encoding: "utf-8", ...options });
}

function cliJson(args, options = {}) {
  return JSON.parse(cli(args, options));
}

function cliExpectFail(args, options = {}) {
  try {
    cli(args, options);
    assert.fail(`expected command to fail: ${args.join(" ")}`);
  } catch (error) {
    assert.ok(error.status !== 0, "exit code must be non-zero");
    return error;
  }
}

describe("REQ-AGENT-090 插件/MCP CLI 命令族", () => {
  let workdir;

  beforeEach(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-plugin-cli-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
  });

  afterEach(() => {
    delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("标准 1a：plugin add（本地路径）→ plugin list 输出含该行（JSON）", () => {
    cli(["plugin", "add", GOOD_EXT]);
    const list = cliJson(["plugin", "list"]);
    const rows = Array.isArray(list) ? list : list.plugins;
    const row = rows.find((r) => r.source === GOOD_EXT);
    assert.ok(row, "list 含新增插件");
    assert.equal(row.name, "pi-extension-good");
    assert.equal(row.scope, "global");
  });

  it("标准 1b：mcp add（stdio）→ mcp list 输出含该 server", () => {
    cli(["mcp", "add", "fixture", "--type", "stdio", "--command", "node", "--args", STDIO_SERVER]);
    const list = cliJson(["mcp", "list"]);
    const rows = Array.isArray(list) ? list : list.servers;
    const row = rows.find((r) => r.name === "fixture");
    assert.ok(row, "list 含新增 server");
    assert.equal(row.type, "stdio");
  });

  it("标准 2：业务错误退出码非零 + stderr 含错误文案", () => {
    const err = cliExpectFail(["plugin", "add", "ht tp://???"]);
    assert.match(String(err.stderr), /格式不正确|invalid source/i);
    const err2 = cliExpectFail(["mcp", "add", "bad", "--type", "http", "--url", "ftp://x"]);
    assert.match(String(err2.stderr), /URL/);
  });

  it("标准 3：enable/disable 与服务层状态一致（list --project 回读对照）", () => {
    cli(["plugin", "add", GOOD_EXT]);
    cli(["plugin", "enable", "pi-extension-good", "--project", "demo"]);
    const list = cliJson(["plugin", "list", "--project", "demo"]);
    const rows = Array.isArray(list) ? list : list.plugins;
    const row = rows.find((r) => r.source === GOOD_EXT);
    assert.ok(row && row.enabled === true, "enable 后 enabled=true");

    cli(["plugin", "disable", "pi-extension-good", "--project", "demo"]);
    const after = cliJson(["plugin", "list", "--project", "demo"]);
    const row2 = (Array.isArray(after) ? after : after.plugins).find((r) => r.source === GOOD_EXT);
    assert.ok(!row2 || row2.enabled === false, "disable 后回全局继承（行不含或 enabled=false）");
  });
});
