// REQ-TRACE: 2026-09-06-cli-service-connection/REQ-CLI-SERVICE-010
// REQ-VERSION: v1-hash:d33ce03b960d1815a224d214724b10561ef35cafcdca3f08152d5543560b12ff
// CAPABILITY-TRACE: command-interface
// ENTITY-TRACE: cli
// EXPECTED-TRACE: prd.md §10.4 接口 1/2/3, §11.1 Seam 1/2/3
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-09-06 assertion signoff, 见 signoff.md)

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../../../../../");
const CLI = ["node", [path.join(ROOT, "src/cli/opc-workstation.js")]];

function runCli(args, options = {}) {
  return execFileSync(CLI[0], [...CLI[1], ...args], { encoding: "utf-8", ...options });
}

function runCliJson(args, options = {}) {
  return JSON.parse(runCli(args, options));
}

function runCliExpectFail(args, options = {}) {
  try {
    runCli(args, options);
    assert.fail(`expected command to fail: ${args.join(" ")}`);
  } catch (error) {
    assert.ok(error.status !== 0, "exit code must be non-zero");
    return error;
  }
}

describe("REQ-CLI-SERVICE-010 产品 CLI cli-service 命令族", () => {
  let workdir;

  beforeEach(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-cmd-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
  });

  afterEach(() => {
    delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("opc-workstation cli-service list --json 输出 3 个内置服务条目", () => {
    // EXPECTED-TRACE: prd.md §10.4 接口 1, §11.1 Seam 1
    const res = runCliJson(["cli-service", "list", "--json"]);
    assert.ok(Array.isArray(res.services), "返回 services 数组");
    assert.equal(res.services.length, 3, "包含 3 个内置条目");
    assert.deepEqual(
      res.services.map((s) => s.id),
      ["claude", "codex", "crawl4ai"]
    );
  });

  it("opc-workstation cli-service probe <id> 返回指定 CLI 的实时探测结果", () => {
    // EXPECTED-TRACE: prd.md §10.4 接口 1, §11.1 Seam 2
    const res = runCliJson(["cli-service", "probe", "claude", "--json"]);
    assert.equal(res.id, "claude");
    assert.equal(typeof res.installed, "boolean");
  });

  it("opc-workstation cli-service env set 与 list：安全展示 key，绝不打印明文 value", () => {
    // 设置环境变量
    // EXPECTED-TRACE: prd.md §10.4 接口 2
    const setOut = runCli([
      "cli-service",
      "env",
      "set",
      "claude",
      "ANTHROPIC_API_KEY=sk-ant-very-sensitive-token",
    ]);
    assert.ok(!setOut.includes("sk-ant-very-sensitive-token"), "set 输出不得含明文 token");
    assert.ok(setOut.includes("ANTHROPIC_API_KEY"), "set 输出确认 KEY 名称");

    // 列出环境变量
    const listOut = runCli(["cli-service", "env", "list", "claude"]);
    assert.ok(!listOut.includes("sk-ant-very-sensitive-token"), "list 输出严禁出现明文 token");
    assert.ok(listOut.includes("ANTHROPIC_API_KEY"), "list 输出包含 KEY");
  });

  it("启用未安装的 CLI 时报错且退出码非 0", () => {
    // 隔离 PATH 确保 codex 处于未安装状态
    const binDir = path.join(workdir, "isolated_bin");
    fs.mkdirSync(binDir, { recursive: true });
    const nodeBin = path.join(binDir, "node");
    try {
      fs.symlinkSync(process.execPath, nodeBin);
    } catch {
      // ignore
    }
    const err = runCliExpectFail(["cli-service", "enable", "codex"], {
      env: {
        ...process.env,
        PATH: binDir,
      },
    });
    assert.ok(
      err.stderr.includes("E-CLI-NOT-INSTALLED") || err.stderr.includes("未安装") || err.stdout.includes("E-CLI-NOT-INSTALLED")
    );
  });
});
