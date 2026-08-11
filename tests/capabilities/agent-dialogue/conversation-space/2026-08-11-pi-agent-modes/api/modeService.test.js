// REQ-TRACE: 2026-08-11-pi-agent-modes/REQ-AGENT-070, 2026-08-11-pi-agent-modes/REQ-AGENT-072, 2026-08-11-pi-agent-modes/REQ-AGENT-077
// REQ-VERSION: v1-hash:3e5839b75173b7b59c41c0da8085ff7f09755fdb443f22c43ebfa310d7813add
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// 模式服务（REQ-AGENT-070 三档 / 072 lastMode / 077 模式不改持久配置）。
//
// seam 1：模式服务模块（BUILD 产物，动态 import，RED 失败而非 import 崩溃）——
//   src/services/modeService.js 导出 createModeService({ settingsService }) 或
//   getMode/setMode/getLastMode/setLastMode 纯函数（实现时接线确认）。
// seam 2：settingsService（既有）持久化 lastMode。
// seam 3：项目 .pi 文件字节比对（REQ-AGENT-077：模式切换不改持久配置）。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function loadModeService() {
  const mod = await import("../../../../../../src/services/modeService.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/modeService.js 尚未实现（REQ-AGENT-070~077）");
  return mod;
}

describe("REQ-AGENT-072 全局 lastMode（B3）", () => {
  let workdir;
  let modeService;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "mode-last-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    const { createModeService } = await loadModeService();
    modeService = await createModeService();
  });

  afterEach(async () => {
    delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("REQ-AGENT-072 标准 1：设置会话模式 → lastMode 记录（settings 持久化）", async () => {
    // TODO: HUMAN ASSERTION — 确认 setMode 后 lastMode 更新（settings 可读回）
    await modeService.setMode("ui:copilot:m1", "auto");
    assert.equal(modeService.getLastMode(), "auto");
  });

  it("REQ-AGENT-072 标准 2：新会话初始模式 = lastMode", async () => {
    await modeService.setMode("ui:copilot:m1", "auto");
    // TODO: HUMAN ASSERTION — 确认新 spaceKey 的 getMode = lastMode（auto）
    assert.equal(modeService.getMode("ui:copilot:m2"), "auto");
  });

  it("REQ-AGENT-072 标准 3：首次（无 lastMode 记录）→ 默认 auto", async () => {
    // TODO: HUMAN ASSERTION — 确认空 settings 下 getMode = auto
    assert.equal(modeService.getMode("ui:copilot:fresh"), "auto");
  });

  it("REQ-AGENT-072 标准 4：lastMode 非法值 → 回落 standard", async () => {
    // 手改 settings 写入非法值（模拟被手改）
    // TODO: HUMAN ASSERTION — 确认非法 lastMode → getMode = standard
    fs.writeFileSync(
      path.join(workdir, "settings.json"),
      JSON.stringify({ agent: { lastMode: "bogus" } })
    );
    const fresh = modeService.getMode("ui:copilot:m3");
    assert.equal(fresh, "standard");
  });
});

describe("REQ-AGENT-070 三档模式（B1）", () => {
  let workdir;
  let modeService;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "mode-three-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    const { createModeService } = await loadModeService();
    modeService = await createModeService();
  });

  afterEach(async () => {
    delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("REQ-AGENT-070 标准 4：模式为会话级——切会话/重开回到全局默认（lastMode），不保留上个会话的模式", async () => {
    await modeService.setMode("ui:copilot:a", "strict");
    // 新会话（同 lastMode 场景下）→ 回到 lastMode（非上个会话的 strict）
    // TODO: HUMAN ASSERTION — 确认新 spaceKey getMode = lastMode（非 strict 残留）
    const fresh = modeService.getMode("ui:copilot:b");
    assert.notEqual(fresh, "strict");
  });
});

describe("REQ-AGENT-077 模式不改持久配置（B8）", () => {
  let workdir;
  let projectDir;
  let modeService;
  const PI_REL = path.join(".pi", "extensions", "pi-permission-system", "config.json");

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "mode-pi-"));
    projectDir = path.join(workdir, "proj");
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(path.dirname(path.join(projectDir, PI_REL)), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, PI_REL),
      JSON.stringify({ permission: { write: "ask" } }, null, 2)
    );
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    const { createModeService } = await loadModeService();
    modeService = await createModeService();
  });

  afterEach(async () => {
    delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("REQ-AGENT-077 标准 1：切换模式（任意档）→ .pi 文件内容不变", async () => {
    const before = fs.readFileSync(path.join(projectDir, PI_REL), "utf8");
    // TODO: HUMAN ASSERTION — 确认模式切换不触碰项目权限配置文件
    await modeService.setMode("ui:project:p1:s1", "auto");
    await modeService.setMode("ui:project:p1:s1", "strict");
    const after = fs.readFileSync(path.join(projectDir, PI_REL), "utf8");
    assert.equal(after, before);
  });
});
