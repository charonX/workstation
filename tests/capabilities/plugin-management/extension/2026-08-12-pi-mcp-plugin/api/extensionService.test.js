// REQ-TRACE: 2026-08-12-pi-mcp-plugin/REQ-AGENT-079, 2026-08-12-pi-mcp-plugin/REQ-AGENT-080, 2026-08-12-pi-mcp-plugin/REQ-AGENT-081
// REQ-VERSION: v1-hash:080af1f439bec8660eeadc84b57fbef5650081f47d8918a7da585b9c172a49a1
// CAPABILITY-TRACE: plugin-management
// ENTITY-TRACE: extension
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-08-13 assertion signoff)

// 插件服务 extensionService（REQ-079 安装三来源 / REQ-080 清单 / REQ-081 项目启用）。
//
// seam：src/services/extensionService.js（BUILD 产物，动态 import，RED 失败而非 import 崩溃）。
//
// 已签契约（门 1，2026-08-13，D1/D2）：
//   工厂：createExtensionService({ agentDir, packageManager? })
//     —— packageManager 为 npm/git 安装的注入缝（测试给 stub，真实安装不走网络）。
//   PluginRow = { name, source, version, scope: "global"|"project", enabled, error? }
//   add(source) → row；list() → row[]；setProjectEnabled(projectDir, source, enabled)
//   项目启用落盘：<projectDir>/.pi/settings.json 资源覆盖模式——
//     启用写 "+<resolved-source>"（先剔同目标旧行，幂等）；停用剔除该行（回全局继承），不写 "-"。
//
// fixture：tests/fixtures/pi-extension-good（合法）、tests/fixtures/pi-extension-bad（加载即抛）。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../../../../../");
const GOOD_EXT = path.join(ROOT, "tests/fixtures/pi-extension-good");
const BAD_EXT = path.join(ROOT, "tests/fixtures/pi-extension-bad");

async function loadExtensionService() {
  const mod = await import("../../../../../../src/services/extensionService.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/extensionService.js 尚未实现（REQ-AGENT-079~081）");
  assert.equal(typeof mod.createExtensionService, "function", "导出 createExtensionService");
  return mod;
}

async function createService(agentDir, extra = {}) {
  const mod = await loadExtensionService();
  return mod.createExtensionService({ agentDir, ...extra });
}

/** npm/git 安装 stub：记录调用，按 shouldFail 决定成败；成功时在 agentDir 下伪造落位目录。 */
function stubPackageManager({ shouldFail = false } = {}) {
  return {
    calls: [],
    async installAndPersist(source) {
      this.calls.push(source);
      if (shouldFail) throw new Error("stub: network install failed");
      return { source };
    },
  };
}

describe("REQ-AGENT-079 插件安装——三种来源（B1）", () => {
  let agentDir;
  let svc;

  beforeEach(async () => {
    agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-agent-home-"));
    svc = await createService(agentDir);
  });

  afterEach(() => {
    fs.rmSync(agentDir, { recursive: true, force: true });
  });

  it("标准 1：本地路径来源登记成功，settings.json 含 resolved 绝对路径，磁盘不拷贝", async () => {
    const row = await svc.add(GOOD_EXT);
    assert.equal(row.name, "pi-extension-good");
    assert.equal(row.source, GOOD_EXT, "source = resolved 绝对路径");
    assert.equal(row.scope, "global");
    const settings = fs.readFileSync(path.join(agentDir, "settings.json"), "utf-8");
    assert.ok(settings.includes(GOOD_EXT), "settings 登记 resolved 绝对路径");
    assert.ok(!fs.existsSync(path.join(agentDir, "local", "pi-extension-good")), "本地来源不拷入 agentHome");
  });

  it("标准 2a：npm 来源经 stub 安装成功，settings 含 npm:<pkg> 记录", async () => {
    const pm = stubPackageManager();
    svc = await createService(agentDir, { packageManager: pm });
    const row = await svc.add("npm:pi-git-checkpoint@1.4.0");
    assert.deepEqual(pm.calls, ["npm:pi-git-checkpoint@1.4.0"]);
    assert.equal(row.name, "pi-git-checkpoint");
    assert.equal(row.version, "1.4.0");
    const settings = fs.readFileSync(path.join(agentDir, "settings.json"), "utf-8");
    assert.ok(settings.includes("pi-git-checkpoint"), "settings 含 npm 包记录");
  });

  it("标准 2b：stub 安装失败 → 不留半成品（settings 无记录）", async () => {
    const pm = stubPackageManager({ shouldFail: true });
    svc = await createService(agentDir, { packageManager: pm });
    await assert.rejects(() => svc.add("npm:ghost-pkg"));
    const settingsPath = path.join(agentDir, "settings.json");
    const settings = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath, "utf-8") : "";
    assert.ok(!settings.includes("ghost-pkg"), "失败不留记录");
  });

  it("标准 3：非法来源格式 → 字段级错误（含格式指引），不落盘（E2）", async () => {
    await assert.rejects(() => svc.add("ht tp://???"), /格式不正确|invalid source/i);
    const settingsPath = path.join(agentDir, "settings.json");
    const settings = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath, "utf-8") : "";
    assert.ok(!settings.includes("ht tp"), "非法来源不落盘");
  });

  it("标准 4：重复添加同一来源 → 幂等，无重复记录（E6）", async () => {
    await svc.add(GOOD_EXT);
    await svc.add(GOOD_EXT);
    const hits = (await svc.list()).filter((r) => r.source === GOOD_EXT);
    assert.equal(hits.length, 1, "同一 resolved 路径只出现一次");
  });
});

describe("REQ-AGENT-080 插件清单读取（B1/B3 数据面）", () => {
  let agentDir;
  let svc;

  beforeEach(async () => {
    agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-agent-home-"));
    svc = await createService(agentDir);
  });

  afterEach(() => {
    fs.rmSync(agentDir, { recursive: true, force: true });
  });

  it("标准 1：空态返回空列表", async () => {
    assert.deepEqual(await svc.list(), []);
  });

  it("标准 2：已装插件行字段完整（名称/来源/版本/scope/enabled）", async () => {
    await svc.add(GOOD_EXT);
    const [row] = await svc.list();
    assert.equal(row.name, "pi-extension-good");
    assert.equal(row.source, GOOD_EXT);
    assert.equal(row.scope, "global");
    assert.equal(typeof row.enabled, "boolean");
  });

  it("标准 3：加载失败的插件以错误态行呈现而非消失", async () => {
    await svc.add(BAD_EXT);
    const bad = (await svc.list()).find((r) => r.source === BAD_EXT);
    assert.ok(bad, "坏插件仍在清单中");
    assert.ok(bad.error, "带 error 字段（依赖官方 per-extension 隔离，spike ① 验证）");
  });
});

describe("REQ-AGENT-081 插件项目启用/停用（B2）", () => {
  let agentDir;
  let projectDir;
  let svc;

  beforeEach(async () => {
    agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-agent-home-"));
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-project-"));
    svc = await createService(agentDir);
    await svc.add(GOOD_EXT);
  });

  afterEach(() => {
    fs.rmSync(agentDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  function projectSettingsRaw() {
    const p = path.join(projectDir, ".pi", "settings.json");
    return fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : "";
  }

  it("标准 1：启用 → 项目 .pi/settings.json 写入 + 模式行", async () => {
    await svc.setProjectEnabled(projectDir, GOOD_EXT, true);
    assert.ok(projectSettingsRaw().includes(`+${GOOD_EXT}`), "含 +<resolved-source> 模式行");
  });

  it("标准 2：停用 → 剔除同目标行，回到全局继承态（不写 - 行）", async () => {
    await svc.setProjectEnabled(projectDir, GOOD_EXT, true);
    await svc.setProjectEnabled(projectDir, GOOD_EXT, false);
    const raw = projectSettingsRaw();
    assert.ok(!raw.includes(GOOD_EXT), "覆盖行已剔除");
    assert.ok(!raw.includes(`-${GOOD_EXT}`), "不写 - 行");
  });

  it("标准 3：未全局安装的插件不可启用 → 业务错误（E6）", async () => {
    await assert.rejects(() => svc.setProjectEnabled(projectDir, "/nonexistent/ext", true), /未安装|not installed/i);
  });

  it("标准 4：重复启用幂等，不产生重复模式行", async () => {
    await svc.setProjectEnabled(projectDir, GOOD_EXT, true);
    await svc.setProjectEnabled(projectDir, GOOD_EXT, true);
    const count = projectSettingsRaw().split(`+${GOOD_EXT}`).length - 1;
    assert.equal(count, 1, "模式行不重复");
  });
});
