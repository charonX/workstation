// src/agent/cliEnvResolver.js
// 纯函数提取：从待执行命令行中识别受管 CLI 裸命令，并从 session-config 快照中解析环境变量
// REQ-CLI-SERVICE-008: 快照环境变量合并
// EXPECTED-TRACE: prd.md §10.4 命令匹配与安全注入契约, ADR-043 (TECH-3 / SEC-3 / CODE-F13)

/**
 * 从待执行命令行中提取首个主命令名称（剥离前导环境变量与外层引号）
 * 安全守卫（SEC-3）：仅裸命令才匹配受管 CLI，包含路径分隔符（如 ./claude 或 /path/to/claude）的命令返回 null，
 * 绝不向未授权二进制注入敏感环境变量。
 * @param {string} commandLine
 * @returns {{ cmdToken: string, cmd: string } | null}
 */
export function extractCommandTokens(commandLine) {
  if (!commandLine || typeof commandLine !== "string") return null;
  const trimmed = commandLine.trim();
  if (!trimmed) return null;

  const tokens = trimmed.split(/\s+/);
  for (const token of tokens) {
    if (!token || /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
      continue;
    }
    const cleanToken = token.replace(/^["']|["']$/g, "");
    // 安全约束：仅裸命令匹配受管 CLI；含路径分隔符的调用不视为受管命令
    if (cleanToken.includes("/") || cleanToken.includes("\\")) {
      return null;
    }
    return { cmdToken: cleanToken, cmd: cleanToken };
  }
  return null;
}

/**
 * 在快照中匹配与待执行命令行对应的 CLI 服务配置
 * @param {string} commandLine
 * @param {Array<Object>} [cliServicesSnapshot]
 * @returns {Object | null}
 */
export function findMatchedCliService(commandLine, cliServicesSnapshot = []) {
  if (!Array.isArray(cliServicesSnapshot) || cliServicesSnapshot.length === 0) {
    return null;
  }
  const extracted = extractCommandTokens(commandLine);
  if (!extracted) return null;
  const { cmd } = extracted;

  return (
    cliServicesSnapshot.find(
      (entry) =>
        entry &&
        (entry.command === cmd || entry.id === cmd)
    ) ?? null
  );
}

/**
 * 根据待执行命令行匹配并解析 CLI 服务注入的环境变量
 * @param {string} commandLine - 命令行字符串
 * @param {Array<Object>} [cliServicesSnapshot] - 会话缓存的 cliServices 快照
 * @returns {Record<string, string>} 解密后的环境变量字典
 */
export function resolveCliEnvForCommand(commandLine, cliServicesSnapshot = []) {
  const matched = findMatchedCliService(commandLine, cliServicesSnapshot);
  if (matched && matched.env && typeof matched.env === "object") {
    return { ...matched.env };
  }
  return {};
}
