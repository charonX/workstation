// REQ-TRACE: 2026-08-24-embedded-browser/REQ-BROWSER-007
// REQ-VERSION: v3-hash:767280fcd03b3f95e71a37b469a292f660d3300a42da2a34e8e4cb2297b6f030
// CAPABILITY-TRACE: embedded-browser
// ENTITY-TRACE: browser-tools
// EXPECTED-TRACE: requirements.md REQ-BROWSER-007 验收标准 1-6（ADR-0040 决策 1-4）
// TEST-AUTHOR: agent
//
// BUG-001 回归（2026-08-31 实证）：外部 AI/CLI 无法发现运行中 app 的 server，
// browser read 返 E-BROWSER-NOT-READY。根因三层：注册表挂 per-configDir（app 与
// CLI 分裂）、main.js 用 E2E fixture 格式覆盖注册记录（丢 pid/owner）、discoverServer
// owner 精确匹配不覆盖 app 场景。修复契约见 ADR-0040（机器级注册表锚点 +
// app 固定 owner="app" + fixture/注册表分离 + 保端口过滤）。
// 隔离约定：凡触发注册表读写的用例均同时设 OPC_SERVER_REGISTRY_FILE（修复后生效）
// 与 OPC_WORKSTATION_CONFIG_DIR（修复前生效）指向 tmp——红绿两态都不触碰真实机器注册表。

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as registry from "../../../../../../src/serverRegistry.js";
import { discoverServer } from "../../../../../../src/cli/server.js";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

const tmpDirs = [];

function mkTmp(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length) {
    fs.rmSync(tmpDirs.pop(), { recursive: true, force: true });
  }
});

// 环境变量罩：设置/删除后恢复原状（支持 async 回调）。
function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  const restore = () => {
    for (const k of Object.keys(vars)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  };
  const result = fn();
  if (result && typeof result.then === "function") return result.finally(restore);
  restore();
  return result;
}

describe("REQ-BROWSER-007 server 发现通道（机器级注册表锚点）", () => {
  it("锚点固定：getServerInfoFile 不随 OPC_WORKSTATION_CONFIG_DIR 变化（ADR-0040 决策1）", () => {
    // EXPECTED-TRACE: REQ-BROWSER-007 验收标准 1
    const cfg = mkTmp("req007-cfg-");
    withEnv(
      { OPC_SERVER_REGISTRY_FILE: undefined, OPC_WORKSTATION_CONFIG_DIR: cfg },
      () => {
        assert.equal(
          registry.getServerInfoFile(),
          path.join(os.homedir(), ".opc-workstation", "server.json")
        );
      }
    );
  });

  it("env 覆盖：OPC_SERVER_REGISTRY_FILE 指向路径承载读写与锁文件（ADR-0040 决策1）", () => {
    // EXPECTED-TRACE: REQ-BROWSER-007 验收标准 2
    const dir = mkTmp("req007-reg-");
    const regFile = path.join(dir, "reg.json");
    withEnv(
      { OPC_SERVER_REGISTRY_FILE: regFile, OPC_WORKSTATION_CONFIG_DIR: path.join(dir, "cfg") },
      () => {
        registry.registerServerRecord(12345, process.pid, "t-owner");
        const records = registry.readServerInfoRaw();
        assert.equal(records.length, 1);
        assert.equal(records[0].port, 12345);
        assert.equal(records[0].owner, "t-owner");
        assert.ok(fs.existsSync(regFile), "注册记录应写入覆盖路径");
        // 锁文件与注册表同路径（<file>.lock）
        const fd = registry.acquireRegistryLock();
        try {
          assert.ok(fs.existsSync(`${regFile}.lock`), "锁文件应为 <registry>.lock");
        } finally {
          registry.releaseRegistryLock(fd);
        }
      }
    );
  });

  it("外部发现 app：owner=app 的可达记录对非匹配 owner 可见（ADR-0040 决策2，BUG-001 复现路径）", async () => {
    // EXPECTED-TRACE: REQ-BROWSER-007 验收标准 3
    // 本进程 discoverServer 的 owner=String(process.ppid)，与记录 owner="app" 不同，
    // 即外部 CLI 上下文。修复前：精确 owner 匹配失败 → null（bug 复现）；
    // 修复后：app 记录兜底 → 返回该 server。
    const dir = mkTmp("req007-app-");
    await withEnv(
      { OPC_SERVER_REGISTRY_FILE: path.join(dir, "server.json"), OPC_WORKSTATION_CONFIG_DIR: dir },
      async () => {
        const ctx = await startServer({ reset: false, owner: "app" });
        try {
          const found = await discoverServer();
          assert.ok(found, "discoverServer 应发现 owner=app 的可达 server（BUG-001 复现路径）");
          assert.equal(found.port, ctx.server.address().port);
          assert.equal(found.baseUrl, `http://127.0.0.1:${ctx.server.address().port}`);
        } finally {
          await stopServer(ctx);
        }
      }
    );
  });

  it("精确 owner 优先：本 owner 与 app 记录并存时返回精确匹配（ADR-0040 决策2）", async () => {
    // EXPECTED-TRACE: REQ-BROWSER-007 验收标准 4
    const dir = mkTmp("req007-prio-");
    await withEnv(
      { OPC_SERVER_REGISTRY_FILE: path.join(dir, "server.json"), OPC_WORKSTATION_CONFIG_DIR: dir },
      async () => {
        const appCtx = await startServer({ reset: false, owner: "app" });
        const ownCtx = await startServer({ reset: false, owner: String(process.ppid) });
        try {
          const found = await discoverServer();
          assert.ok(found, "存在可达记录时应发现 server");
          assert.equal(
            found.port,
            ownCtx.server.address().port,
            "精确 owner 匹配应优先于 owner=app 兜底"
          );
        } finally {
          await stopServer(ownCtx);
          await stopServer(appCtx);
        }
      }
    );
  });

  it("app 注册形态：记录含 pid/owner/startedAt，fixture 文件写入不破坏注册记录（ADR-0040 决策3）", async () => {
    // EXPECTED-TRACE: REQ-BROWSER-007 验收标准 5
    // 修复前：注册表=userData/server.json，fixture 写入即覆盖注册记录（丢 pid/owner）→ 红；
    // 修复后：注册表与 fixture 为两个文件，互不影响 → 绿。
    const dir = mkTmp("req007-fixture-");
    const userData = path.join(dir, "userData");
    fs.mkdirSync(userData, { recursive: true });
    await withEnv(
      {
        OPC_SERVER_REGISTRY_FILE: path.join(dir, "registry", "server.json"),
        OPC_WORKSTATION_CONFIG_DIR: userData,
      },
      async () => {
        const ctx = await startServer({ reset: false, owner: "app" });
        try {
          const port = ctx.server.address().port;
          let records = registry.readServerInfoRaw();
          assert.equal(records.length, 1);
          assert.equal(records[0].owner, "app");
          assert.equal(records[0].pid, process.pid);
          assert.ok(records[0].port > 0);
          assert.ok(records[0].startedAt, "注册记录应含 startedAt");
          // 模拟 main.js 写 E2E fixture（userData/server.json，{port, baseUrl} 格式）
          fs.writeFileSync(
            path.join(userData, "server.json"),
            JSON.stringify({ port, baseUrl: `http://127.0.0.1:${port}` }, null, 2)
          );
          records = registry.readServerInfoRaw();
          assert.equal(records.length, 1, "fixture 写入不得破坏注册记录");
          assert.equal(records[0].owner, "app", "fixture 写入不得破坏注册记录 owner");
          assert.ok(records[0].pid, "fixture 写入不得破坏注册记录 pid");
        } finally {
          await stopServer(ctx);
        }
      }
    );
  });

  it("保端口过滤：pickAppPreferredPort 只取 owner=app 的最近记录（ADR-0040 决策4）", () => {
    // EXPECTED-TRACE: REQ-BROWSER-007 验收标准 6
    assert.equal(
      typeof registry.pickAppPreferredPort,
      "function",
      "serverRegistry 应导出 pickAppPreferredPort（app 重启保端口的选择函数 seam）"
    );
    assert.equal(
      registry.pickAppPreferredPort([
        { port: 1111, pid: 1, owner: "app" },
        { port: 2222, pid: 2, owner: "99999" },
      ]),
      1111,
      "更晚写入的 headless 记录不得成为 app 保端口来源"
    );
    assert.equal(
      registry.pickAppPreferredPort([{ port: 2222, pid: 2, owner: "99999" }]),
      0,
      "无 app 记录时回退 0（随机端口）"
    );
    assert.equal(registry.pickAppPreferredPort([]), 0);
  });
});
