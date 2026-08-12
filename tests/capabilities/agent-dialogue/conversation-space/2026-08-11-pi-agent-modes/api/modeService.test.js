// REQ-TRACE: 2026-08-11-pi-agent-modes/REQ-AGENT-070, 2026-08-11-pi-agent-modes/REQ-AGENT-071, 2026-08-11-pi-agent-modes/REQ-AGENT-072, 2026-08-11-pi-agent-modes/REQ-AGENT-077
// REQ-VERSION: v1-hash:3e5839b75173b7b59c41c0da8085ff7f09755fdb443f22c43ebfa310d7813add
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true
// BUG-TRACE: BUG-001

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
import { startServer, stopServer } from "../../../../../../src/http/server.js";

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

  it("REQ-AGENT-070 标准 4：模式为会话级——显式会话值按 spaceKey 隔离，未设置会话跟随 lastMode", async () => {
    // 语义修正（2026-08-12 人授权 ×2）：① setMode 写 lastMode（072 标准 1）；
    // ② 会话隔离 = 显式会话值按 spaceKey 独立——a 的显式值不注入 b；b 未显式
    // 设置时 = lastMode（动态跟随，每次读全局值）。
    // 两个会话各自显式设置 → 互不影响。
    await modeService.setMode("ui:copilot:a", "strict");
    await modeService.setMode("ui:copilot:b", "auto");
    assert.equal(modeService.getMode("ui:copilot:a"), "strict");
    assert.equal(modeService.getMode("ui:copilot:b"), "auto", "显式会话值按 spaceKey 隔离");

    // a 切走后不影响 b 的显式值
    await modeService.setMode("ui:copilot:a", "auto");
    assert.equal(modeService.getMode("ui:copilot:b"), "auto", "a 后续切换不影响 b 的显式值");

    // 未设置的会话跟随 lastMode（a 最后一次设 auto → lastMode=auto）
    assert.equal(modeService.getMode("ui:copilot:new"), "auto", "未设置会话 = lastMode");
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

describe("BUG-001 回归：无会话切模式落盘全局 lastMode（HTTP 集成面）", () => {
  // 集成面（modeService 直写单测之外的「renderer 无会话切换 → 落盘」链路）：
  // 切严格模式 → 发送对话 → 模式跳回 auto 的根因 = Assistant.handleModeChange
  // 在 selectedKey 为 null（还没选/建会话）时 `if (!key) return` 静默丢弃切换
  // ——UI 乐观显示但服务端从未收到 PUT（lastMode 仍 auto）；随后发送首条消息 →
  // createSession → 切会话 effect 复位 + GET 取位（= lastMode = auto）→ 回 auto。
  // 裁决 A：无会话时切模式 = 改全局默认（lastMode 落盘）。
  //
  // seam：HTTP 端点（startServer + fetch）。无会话的 lastMode 设置端点 =
  // PUT /api/agent/mode/last { mode } → { mode }（修复前不存在 → 404 红）；
  // 随后新建会话 GET /api/agent/sessions/:key/mode 取位 = 新 lastMode
  // （REQ-AGENT-072 标准 2：新会话初始模式 = lastMode；修复前 = auto 红）。
  let serverCtx;
  let workdir;
  const JSON_HEADERS = { "Content-Type": "application/json" };

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "mode-last-http-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    serverCtx = await startServer();
  });

  afterEach(async () => {
    await stopServer(serverCtx);
    delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("BUG-001：无会话 PUT 全局 lastMode=strict → 新建会话 GET mode = strict（修复前红：PUT 404 / GET=auto）", async () => {
    const putRes = await fetch(`${serverCtx.baseUrl}/api/agent/mode/last`, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ mode: "strict" }),
    });
    const putBody = await putRes.json().catch(() => ({}));
    assert.equal(
      putRes.status,
      200,
      `无会话 PUT 全局 lastMode 应 200，实际 ${putRes.status}: ${JSON.stringify(putBody)}`
    );
    assert.equal(putBody.mode, "strict", "PUT 响应应回显生效值（落盘后回读）");

    // 新建会话（bug 现场：无会话切 strict → 发送首条消息 createSession）
    const createRes = await fetch(`${serverCtx.baseUrl}/api/agent/sessions`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ spaceKind: "general" }),
    });
    const createBody = await createRes.json().catch(() => ({}));
    assert.equal(
      createRes.status,
      200,
      `POST 建会话应 200，实际 ${createRes.status}: ${JSON.stringify(createBody)}`
    );
    assert.match(createBody.spaceKey ?? "", /^ui:copilot:.+/, "通用空间 spaceKey 应匹配 ^ui:copilot:.+");

    // 修复前：无 key 切换被静默丢弃 → lastMode 仍 auto → 新会话取位 = auto（红）；
    // 修复后：lastMode=strict 落盘 → 新会话初始模式 = strict（REQ-AGENT-072 标准 2）。
    const getRes = await fetch(`${serverCtx.baseUrl}/api/agent/sessions/${createBody.spaceKey}/mode`);
    const getBody = await getRes.json().catch(() => ({}));
    assert.equal(getRes.status, 200, `GET mode 应 200，实际 ${getRes.status}: ${JSON.stringify(getBody)}`);
    assert.equal(getBody.mode, "strict", "新会话初始模式 = lastMode（BUG-001 裁决 A）");
  });
});
