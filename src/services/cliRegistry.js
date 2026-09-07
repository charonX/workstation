// src/services/cliRegistry.js
// REQ-CLI-SERVICE-001: 内置 CLI 清单注册表与数据结构
// EXPECTED-TRACE: prd.md §6.3 块 1, §10.2

/**
 * 内置清单注册表配置项
 * @typedef {Object} CliRegistryItem
 * @property {string} id - 唯一标识符，如 "claude"
 * @property {string} displayName - 界面显示名称
 * @property {string} command - 探测与执行的主命令名
 * @property {string[]} versionArgs - 版本检测参数数组，如 ["--version"]
 * @property {string} versionRegex - 版本号正则提取模式（默认捕获首个 semver）
 * @property {"npm" | "pypi"} channel - 分发渠道
 * @property {string} package - 官方分发包名
 * @property {string} installHint - 安装指引提示命令
 * @property {string} builtinSkillSlug - 对应的内置技能 slug
 */

export const CLI_REGISTRY = Object.freeze([
  {
    id: "claude",
    displayName: "Claude Code",
    command: "claude",
    versionArgs: ["--version"],
    versionRegex: "(\\d+\\.\\d+\\.\\d+)",
    channel: "npm",
    package: "@anthropic-ai/claude-code",
    installHint: "npm install -g @anthropic-ai/claude-code",
    builtinSkillSlug: "cli-claude",
  },
  {
    id: "codex",
    displayName: "Codex CLI",
    command: "codex",
    versionArgs: ["--version"],
    versionRegex: "(\\d+\\.\\d+\\.\\d+)",
    channel: "npm",
    package: "@openai/codex",
    installHint: "npm install -g @openai/codex",
    builtinSkillSlug: "cli-codex",
  },
]);

/**
 * 获取完整的内置 CLI 清单
 * @returns {CliRegistryItem[]} 清单条目数组（顺序固定为 claude, codex）
 */
export function getRegistry() {
  return [...CLI_REGISTRY];
}

/**
 * 按 id 查找内置 CLI 清单条目
 * @param {string} id - 条目 id
 * @returns {CliRegistryItem | null} 匹配条目或 null
 */
export function findRegistryItem(id) {
  return CLI_REGISTRY.find((item) => item.id === id) || null;
}
