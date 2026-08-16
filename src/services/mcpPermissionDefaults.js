// src/services/mcpPermissionDefaults.js
// BUG-014（REQ-AGENT-087 默认层，2026-08-16 人拍板「默认层存 workstation DB」）：
// 用户级 MCP 默认权限——DB 表 mcp_permission_defaults（pattern 主键 =
// server:tool glob，verdict ∈ allow/ask/deny），三处消费：
//   1. HTTP CRUD（mcpService.listPermissionDefaults/replacePermissionDefaults 委托）；
//   2. worker 部署合并（deployGlobalPolicy 把默认层 merge 进 gotgenes 全局
//      config.json 的 permission.mcp——"*" 保持首位，gotgenes 同层
//      last-match-wins，具体 pattern 必须后于 "*" 才生效）；
//   3. 视图合并（permissionConfigService.getPermissionView 的 global 先合并默认层，
//      项目页 mcp 族行 global = 用户默认，projectOverridden 对照之）。
//
// 轻依赖纪律：只 import db.js——worker 部署链路也 import 本模块，不得拉
// mcpService（secretStore / MCP SDK 图）进 worker bundle。

import os from "node:os";
import path from "node:path";
import { getDb } from "../db.js";

const VERDICTS = new Set(["allow", "ask", "deny"]);

// 与 mcpService.resolveDbPath 同规则（DB_PATH 优先；worker 经 spawn 继承
// process.env——Electron 经 bootstrap-env 设 userData，headless 经 server.js）。
function resolveDbPath() {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  const configDir = process.env.OPC_WORKSTATION_CONFIG_DIR || path.join(os.homedir(), ".opc-workstation");
  return path.join(configDir, "data.db");
}

/** 默认层校验：rules = { pattern: verdict }；pattern 须含「:」，verdict ∈ allow/ask/deny。 */
export function validateMcpPermissionDefaults(rules) {
  if (!rules || typeof rules !== "object" || Array.isArray(rules)) {
    throw new Error("默认权限 rules 须为 { server:tool glob: verdict } 对象");
  }
  for (const [pattern, verdict] of Object.entries(rules)) {
    if (!pattern.includes(":")) {
      throw new Error(`默认权限 pattern 须为 server:tool 形态: ${pattern}`);
    }
    if (!VERDICTS.has(verdict)) {
      throw new Error(`默认权限 verdict 不合法（allow/ask/deny）: ${pattern} → ${verdict}`);
    }
  }
}

/** 读默认层 → { pattern: verdict }（插入序——ORDER BY rowid；TEXT 主键索引序 ≠ 插入序）。 */
export function listMcpPermissionDefaults(dbPath) {
  const d = getDb(dbPath ?? resolveDbPath());
  const rows = d.prepare("SELECT pattern, verdict FROM mcp_permission_defaults ORDER BY rowid").all();
  return Object.fromEntries(rows.map((r) => [r.pattern, r.verdict]));
}

/** 全量替换默认层（校验失败不落库；事务保证「删旧插新」原子）。 */
export function replaceMcpPermissionDefaults(rules, dbPath) {
  validateMcpPermissionDefaults(rules);
  const d = getDb(dbPath ?? resolveDbPath());
  const tx = d.transaction(() => {
    d.prepare("DELETE FROM mcp_permission_defaults").run();
    const ins = d.prepare("INSERT INTO mcp_permission_defaults (pattern, verdict) VALUES (?, ?)");
    for (const [pattern, verdict] of Object.entries(rules)) {
      ins.run(pattern, verdict);
    }
  });
  tx();
  return { ...rules };
}

/**
 * 把默认层 merge 进策略对象的 permission.mcp（纯函数，输入不可变）：
 * 出厂 `"*": "ask"` 保持首位，用户 pattern 追加在后（同名既有键删后重插移到
 * 末尾）——gotgenes 同层 last-match-wins，具体 pattern 必须后于 "*" 才生效。
 * 空默认层 → 原样返回（同一引用）：REQ-AGENT-060 兼容——视图 body.global 须与
 * 部署 JSON 原文逐字节一致。
 */
export function mergeMcpDefaultsIntoPolicy(policy, rules) {
  const entries = Object.entries(rules ?? {});
  if (entries.length === 0) return policy;
  const base = policy && typeof policy === "object" ? policy : {};
  const basePerm = base.permission && typeof base.permission === "object" ? base.permission : {};
  const baseMcp =
    basePerm.mcp && typeof basePerm.mcp === "object" && !Array.isArray(basePerm.mcp) ? basePerm.mcp : {};
  const mcp = { ...baseMcp };
  for (const [pattern, verdict] of entries) {
    delete mcp[pattern];
    mcp[pattern] = verdict;
  }
  return { ...base, permission: { ...basePerm, mcp } };
}
