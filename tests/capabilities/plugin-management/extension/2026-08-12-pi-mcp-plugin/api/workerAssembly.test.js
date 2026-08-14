// REQ-TRACE: 2026-08-12-pi-mcp-plugin/REQ-AGENT-082, 2026-08-12-pi-mcp-plugin/REQ-AGENT-089
// REQ-VERSION: v1-hash:6c7fd998525a697ef21587c808800edfb15182b428d588f83c9ae835acf09243
// CAPABILITY-TRACE: plugin-management
// ENTITY-TRACE: extension
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-08-13 assertion signoff)

// worker 会话装配接入官方发现链路（REQ-082）与故障隔离（REQ-089）。
//
// seam：src/agent/sessionAssembly.js（BUILD 产物，动态 import）。
//
// 已签契约（门 1，2026-08-13，D3/D6）：
//   assembleSessionExtensions({ cwd, agentDir, mcpSnapshot?, packageManager? })
//     → { resolved, factories, diagnostics }
//   resolved：官方 resolve() 两级求值后的插件条目（含 enabled/scope）。
//   factories：内联 extensionFactories，固定序且带稳定 name：
//     ["opc-permission-bridge", "gotgenes-permission-system", "pi-mcp-adapter"]。
//   diagnostics：单插件加载错误等诊断记录数组（故障隔离的可见面）。
//   packageManager 注入缝：缺包时断言 0 次安装调用（onMissing="error" 不联网）。
//   缺包错误消息：含包名 + 「请到 管理区 → 插件 页重新安装」指引（E2E 只锁「插件」+包名）。
//
// fixture：tests/fixtures/pi-extension-good、pi-extension-bad。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../../../../../");
const GOOD_EXT = path.join(ROOT, "tests/fixtures/pi-extension-good");
const BAD_EXT = path.join(ROOT, "tests/fixtures/pi-extension-bad");

async function loadAssembly() {
  const mod = await import("../../../../../../src/agent/sessionAssembly.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/agent/sessionAssembly.js 尚未实现（REQ-AGENT-082/089）");
  assert.equal(typeof mod.assembleSessionExtensions, "function", "导出 assembleSessionExtensions");
  return mod;
}

function installSpy() {
  return { installCalls: 0, async installAndPersist() { this.installCalls += 1; } };
}

/** 在 agentDir 全局 settings 声明本地来源插件，并可选在项目写入 + 覆盖模式。 */
function declareGlobalPlugin(agentDir, source) {
  fs.writeFileSync(
    path.join(agentDir, "settings.json"),
    JSON.stringify({ extensions: [source] }, null, 2)
  );
}

function enableInProject(projectDir, source) {
  const p = path.join(projectDir, ".pi", "settings.json");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ extensions: [`+${source}`] }, null, 2));
}

describe("REQ-AGENT-082 会话装配接入官方发现链路（B1/B2/B8 worker 侧）", () => {
  let agentDir;
  let projectA;
  let projectB;
  let assemble;

  beforeEach(async () => {
    agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-agent-home-"));
    projectA = fs.mkdtempSync(path.join(os.tmpdir(), "pi-proj-a-"));
    projectB = fs.mkdtempSync(path.join(os.tmpdir(), "pi-proj-b-"));
    ({ assembleSessionExtensions: assemble } = await loadAssembly());
  });

  afterEach(() => {
    for (const d of [agentDir, projectA, projectB]) fs.rmSync(d, { recursive: true, force: true });
  });

  it("标准 1：项目 A 启用插件 → A 装配 resolved 含该插件；未启用的 B 不含", async () => {
    declareGlobalPlugin(agentDir, GOOD_EXT);
    enableInProject(projectA, GOOD_EXT);
    const ra = await assemble({ cwd: projectA, agentDir });
    const rb = await assemble({ cwd: projectB, agentDir });
    assert.ok(
      ra.resolved.some((r) => String(r.source ?? r.path ?? "").includes("pi-extension-good") && r.enabled),
      "A 的 resolved 含已启用插件"
    );
    assert.ok(
      !rb.resolved.some((r) => String(r.source ?? r.path ?? "").includes("pi-extension-good") && r.enabled),
      "B 不含（全局声明未启用≠项目启用）"
    );
  });

  it("标准 2：内联 factories 固定序 [授权桥, gotgenes, MCP桥]", async () => {
    const { factories } = await assemble({ cwd: projectA, agentDir });
    assert.deepEqual(
      factories.map((f) => f.name),
      ["opc-permission-bridge", "gotgenes-permission-system", "pi-mcp-adapter"],
      "顺序宿主控制，授权桥先于 gotgenes"
    );
  });

  it("标准 3：settings 声明但磁盘缺失 → 装配失败，错误含包名与插件页指引；0 次网络安装", async () => {
    declareGlobalPlugin(agentDir, "npm:ghost-missing-pkg");
    const pm = installSpy();
    await assert.rejects(
      () => assemble({ cwd: projectA, agentDir, packageManager: pm }),
      (err) => {
        assert.ok(err.message.includes("ghost-missing-pkg"), "错误含包名");
        assert.ok(err.message.includes("插件"), "错误含插件页重装指引");
        return true;
      }
    );
    assert.equal(pm.installCalls, 0, "onMissing=error，不发网络安装");
  });

  it("标准 4：通用空间（cwd 无 .pi）只加载全局启用面", async () => {
    declareGlobalPlugin(agentDir, GOOD_EXT);
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), "pi-plain-"));
    try {
      const { resolved } = await assemble({ cwd: plain, agentDir });
      assert.ok(
        !resolved.some((r) => String(r.source ?? r.path ?? "").includes("pi-extension-good") && r.enabled && r.scope === "project"),
        "无项目 settings 时不存在 project 级启用项"
      );
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });
});

describe("REQ-AGENT-089 故障隔离（B8）", () => {
  let agentDir;
  let projectDir;
  let assemble;

  beforeEach(async () => {
    agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-agent-home-"));
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-proj-"));
    ({ assembleSessionExtensions: assemble } = await loadAssembly());
  });

  afterEach(() => {
    fs.rmSync(agentDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it("标准 1：坏插件存在时——装配成功、好插件在列、诊断含坏插件记录", async () => {
    declareGlobalPlugin(agentDir, GOOD_EXT);
    fs.writeFileSync(
      path.join(agentDir, "settings.json"),
      JSON.stringify({ extensions: [GOOD_EXT, BAD_EXT] }, null, 2)
    );
    enableInProject(projectDir, GOOD_EXT);
    enableInProject(projectDir, BAD_EXT);
    const { resolved, diagnostics } = await assemble({ cwd: projectDir, agentDir });
    assert.ok(
      resolved.some((r) => String(r.source ?? r.path ?? "").includes("pi-extension-good") && r.enabled),
      "好插件不受影响"
    );
    assert.ok(
      diagnostics.some((d) => String(d.message ?? d).includes("pi-extension-bad")),
      "诊断含坏插件记录（spike ① per-extension 隔离）"
    );
  });

  it("标准 3：桥自身加载失败（畸形快照）→ 会话仍可用 + 诊断可见", async () => {
    const { factories, diagnostics } = await assemble({
      cwd: projectDir,
      agentDir,
      mcpSnapshot: { servers: "not-a-map" },
    });
    assert.deepEqual(
      factories.map((f) => f.name),
      ["opc-permission-bridge", "gotgenes-permission-system"],
      "桥剔除，授权链保留"
    );
    assert.ok(
      diagnostics.some((d) => String(d.message ?? d).includes("mcp")),
      "诊断含桥失败记录"
    );
  });
});
