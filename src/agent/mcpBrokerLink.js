// src/agent/mcpBrokerLink.js
// MCP 权限 broker 接线 link（REQ-AGENT-086，B6 核心）。
//
// pi-mcp-adapter 的 broker 事件 `pi-mcp-adapter:tool-approval-request` 载荷：
//   { requestId, serverName, originalToolName, prefixedToolName, args, origin, signal?, claim }
// 本 link 把该事件接到授权桥（gotgenes checkPermission）与确认挂起队列：
//   - 恒以 ("mcp", "<serverName>:<originalToolName>") 调 checkPermission（D1 mcp 面，
//     gotgenes 原生预留；server:tool glob，默认 ask）；
//   - allow → claim("allow_once")；deny → claim("deny")（reason 回 agent）；
//   - ask → 确认卡（standard 默认）；strict 全确认（即使规则 allow 也弹卡）；
//     auto 先过 decide（模型 link）：allow 直放 / deny 拦截 / defer 才弹卡；
//   - 一期不返回 "allow_for_session"；
//   - 任何内部异常 / 无人确认 → fail-closed claim("deny")，不抛出；
//   - reviewLog(record) 每次裁决落痕（record = { serverName, tool, verdict }）。
//
// 纯逻辑（依赖注入），无外部 IO——worker 装配时注入 checkPermission/askConfirmation/
// mode/decide/reviewLog（session 上下文闭包）。mode 支持字符串（构造时固定）或函数
// （每次求值实时读当前会话模式——模式切换生效于下一个评估）。

/**
 * createMcpBrokerLink({ checkPermission, askConfirmation, mode, decide?, reviewLog? })
 *   → { async handleApproval(payload, claim) }
 *   - checkPermission(surface, value) → "allow" | "ask" | "deny"（gotgenes 求值）
 *   - askConfirmation(payload) → "allow" | "deny"（人裁决）
 *   - mode: "strict" | "standard" | "auto"（或 () => mode 实时求值）
 *   - decide(payload) → { kind: "allow" | "deny" | "defer", reason? }（auto 档模型 link）
 *   - reviewLog(record)：每次裁决落痕
 */
export function createMcpBrokerLink({ checkPermission, askConfirmation, mode = "standard", decide, reviewLog } = {}) {
  if (typeof checkPermission !== "function") {
    throw Object.assign(new Error("E-MCP-BROKER-CONFIG: checkPermission 必填"), { code: "E-MCP-BROKER-CONFIG" });
  }

  async function handleApproval(payload, claim) {
    const serverName = payload?.serverName;
    const tool = String(payload?.originalToolName ?? "");
    let decision;
    try {
      const currentMode = typeof mode === "function" ? mode() : mode;
      const verdict = await checkPermission("mcp", `${serverName}:${tool}`);
      if (verdict === "deny") {
        // 规则 deny：不弹卡不执行，deny（reason 回 agent）。
        decision = "deny";
      } else if (verdict === "allow" && currentMode !== "strict") {
        // 规则 allow → 直放（strict 下即使 allow 也弹卡）。
        decision = "allow_once";
      } else {
        // ask（未匹配规则默认 ask）；strict 下 allow 也走本路径弹卡。
        decision = await askForDecision(payload, currentMode);
      }
    } catch {
      // 任何异常/无人确认 → fail-closed deny，不抛出（桥 headless 边界）。
      decision = "deny";
    }
    try {
      reviewLog?.({ serverName, tool, verdict: decision });
    } catch {
      // reviewLog 写失败不致命（不影响裁决与执行）。
    }
    // claim 契约 = 处理器函数（桥 broker 与测试 harness 均以函数形态收裁决）。
    return claim(() => decision);
  }

  async function askForDecision(payload, currentMode) {
    if (currentMode === "auto" && typeof decide === "function") {
      // auto：模型 link 先判（allow 直放 / deny 拦截 / defer 才弹卡）。
      const r = await decide(payload);
      if (r?.kind === "allow") return "allow_once";
      if (r?.kind === "deny") return "deny";
      // defer / 模型失败 → 弹确认卡。
    }
    const answer = await askConfirmation(payload);
    return answer === "allow" ? "allow_once" : "deny";
  }

  return { handleApproval };
}
