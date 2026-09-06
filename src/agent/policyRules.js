// src/agent/policyRules.js
// 出厂权限规则与项目层覆盖规则生成器（REQ-CLI-SERVICE-008）
// EXPECTED-TRACE: prd.md §10.2, §10.5 决策 1, ADR-043

import { BASH_RULES as SERVICE_BASH_RULES } from "../services/policyRules.js";

export const BASH_RULES = SERVICE_BASH_RULES.map((rule) => ({
  ...rule,
  action: rule.action ?? rule.decision ?? "ask",
}));

export const SUPPORTED_CLI_COMMANDS = Object.freeze(["claude", "codex", "crwl"]);

/**
 * 构建项目层 Bash 权限覆盖规则
 * 未启用的 CLI 服务判定为 deny，已启用的 CLI 服务不生成规则自然回落出厂 ask 层
 * @param {Object} [options]
 * @param {string[]} [options.enabledCliCommands] - 项目已启用的 CLI 命令列表
 * @returns {Array<{ pattern: string, action: string, decision: string }>}
 */
export function buildProjectBashRules({ enabledCliCommands = [] } = {}) {
  const safeCommands = Array.isArray(enabledCliCommands) ? enabledCliCommands : [];
  const enabledSet = new Set(safeCommands);
  const rules = [];

  for (const cmd of SUPPORTED_CLI_COMMANDS) {
    if (!enabledSet.has(cmd)) {
      rules.push({
        pattern: `${cmd} *`,
        action: "deny",
        decision: "deny",
      });
      rules.push({
        pattern: cmd,
        action: "deny",
        decision: "deny",
      });
    }
  }

  return rules;
}
