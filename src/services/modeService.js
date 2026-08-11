// src/services/modeService.js
// PI Agent 模式服务（2026-08-11-pi-agent-modes，Slice 1；REQ-AGENT-070/072/077）。
//
// 职责边界（PRD §10.2/§10.4）：
// - 三档模式（strict/standard/auto）会话级状态：getMode(spaceKey) / setMode(spaceKey, mode)；
//   会话显式切过 → 会话值；未切过 → 全局 lastMode（新会话不保留上个会话的模式）；
// - 全局 lastMode（settings agent.lastMode 持久化）：getLastMode() / setLastMode(mode)；
//   首次（无记录）→ auto；非法值（settings 被手改）→ standard（REQ-AGENT-072 标准 4）；
// - 模式是运行时档位（REQ-AGENT-077）：切换只动会话状态 + settings lastMode，
//   绝不触碰项目 .pi 权限配置文件。
//
// 读写语义（对齐 settingsService seam）：
// - lastMode 读取每次从 settings.json 新鲜读盘，不经 settingsService 内存缓存——
//   BUG-009 后 settingsService 的 ensureLoaded 缓存一经加载即定格，手改文件场景
//   （REQ-AGENT-072 标准 4）必须立即可感知；文件缺失/坏 JSON → auto（首次默认）；
// - lastMode 写入经 settingsService.saveSettings 合并写盘（保留 settings 既有内容，
//   尤其 agent 下 provider/apiKey 密文/identity/configured 等字段——不可被 lastMode
//   写入覆盖），并同步内存缓存保持 agent 配置视图一致。

import fs from "node:fs";
import path from "node:path";
import * as settingsService from "./settingsService.js";

export const AGENT_MODES = ["strict", "standard", "auto"];
const DEFAULT_LAST_MODE = "auto";
const INVALID_LAST_MODE_FALLBACK = "standard";
const SETTINGS_FILE = "settings.json";

function isValidMode(mode) {
  return AGENT_MODES.includes(mode);
}

// settings.json agent.lastMode 新鲜读盘（绕过 settingsService 内存缓存）。
function readLastModeFromDisk(configDir) {
  try {
    const raw = fs.readFileSync(path.join(configDir, SETTINGS_FILE), "utf8");
    const data = JSON.parse(raw);
    const lastMode = data?.agent?.lastMode;
    if (typeof lastMode !== "string") return DEFAULT_LAST_MODE;
    return isValidMode(lastMode) ? lastMode : INVALID_LAST_MODE_FALLBACK;
  } catch {
    // 文件缺失/坏 JSON → 首次默认 auto
    return DEFAULT_LAST_MODE;
  }
}

export function createModeService({ settingsService: ss = settingsService } = {}) {
  // 会话显式模式（会话级状态）：切会话/重开不保留——新会话回全局 lastMode
  const sessionModes = new Map();

  function getLastMode() {
    return readLastModeFromDisk(ss.configDir());
  }

  function setLastMode(mode) {
    const configDir = ss.configDir();
    // 保留 settings.json 既有内容（agent 下 provider/apiKey 密文等字段不可被覆盖）
    let existing = {};
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(configDir, SETTINGS_FILE), "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) existing = parsed;
    } catch {
      // 无既有 settings → 从空对象合并
    }
    const agent =
      existing.agent && typeof existing.agent === "object" && !Array.isArray(existing.agent)
        ? { ...existing.agent }
        : {};
    ss.saveSettings({ agent: { ...agent, lastMode: mode } });
  }

  function getMode(spaceKey) {
    if (sessionModes.has(spaceKey)) return sessionModes.get(spaceKey);
    return getLastMode();
  }

  function setMode(spaceKey, mode) {
    sessionModes.set(spaceKey, mode);
    setLastMode(mode);
  }

  return { getMode, setMode, getLastMode, setLastMode };
}
