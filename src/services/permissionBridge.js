// src/services/permissionBridge.js
// 授权桥（2026-08-02-ui-copilot REQ-AGENT-033，S8 M2；ADR-032 深化）。
//
// 职责：
// - 桥接 Worker 侧 tool_call / user_bash / pre-gate 拦截至主进程 PermissionAdjudicator；
// - 支持 adjudicator / confirmationService 双入参兼容，支持 modeService 注入；
// - 内聚 strict 模式判定：在 policy 评估层直接响应 strict 全量 ask，无须在 server 层手写分支；
// - 统一提供 handlePermissionAsk 接口，使 server.js 仅承担单点 IPC 消息转发。

import { randomUUID } from "node:crypto";
import { createPolicyEvaluator, classifyBashToolCall } from "./permissionPolicy.js";

const POLL_INTERVAL_MS = 20;

export function createPermissionBridge({ adjudicator, confirmationService, modeService } = {}) {
  const svc = adjudicator ?? confirmationService;
  if (!svc || typeof svc.submit !== "function" || typeof svc.get !== "function") {
    throw Object.assign(new Error("E-BRIDGE-CONFIG: adjudicator / confirmationService 必填（submit/get）"), {
      code: "E-BRIDGE-CONFIG",
    });
  }

  function waitForDecision(confirmId) {
    if (typeof svc.waitForDecision === "function") {
      return svc.waitForDecision(confirmId);
    }
    return new Promise((resolve) => {
      const timer = setInterval(() => {
        const row = svc.get(confirmId);
        if (!row) return;
        if (row.status === "approved") {
          clearInterval(timer);
          resolve({ kind: "allow" });
        } else if (row.status === "rejected") {
          clearInterval(timer);
          resolve({ kind: "deny", reason: "操作已取消（用户拒绝）" });
        }
      }, POLL_INTERVAL_MS);
      timer.unref?.();
    });
  }

  async function authorize({ spaceKey, tool, input, description: _description, confirmId } = {}) {
    const id = confirmId ?? randomUUID();
    svc.submit({
      confirmId: id,
      sessionKey: spaceKey ?? "",
      command: tool ?? "permission",
      args: input ?? {},
      riskLevel: "permission",
      notifyOnSettle: false,
    });
    return { confirmId: id, decision: waitForDecision(id) };
  }

  async function evaluateUserBash({ spaceKey, command, cwd, confirmId, mode: explicitMode } = {}) {
    const mode = explicitMode ?? (modeService ? modeService.getMode(spaceKey) : undefined);
    const evaluator = createPolicyEvaluator({ cwd, mode });
    const verdict = evaluator.evaluate({ tool: "bash", input: { command } });
    if (verdict === "allow") return { verdict: "allow" };
    return {
      verdict: "ask",
      ...(await authorize({
        spaceKey,
        tool: "user_bash",
        input: { command },
        description: `user_bash: ${command}`,
        confirmId,
      })),
    };
  }

  async function evaluateBashToolCall({ spaceKey, command, cwd, projectDir, confirmId } = {}) {
    const verdict = classifyBashToolCall(command, { cwd, projectDir });
    if (verdict === "allow") return { verdict: "allow" };
    return {
      verdict: "ask",
      ...(await authorize({
        spaceKey,
        tool: "bash",
        input: { command },
        description: `bash: ${command}`,
        confirmId,
      })),
    };
  }

  // 统一权限请求入口（消除 server.js 手写 if-else 与 strict 重复逻辑）
  async function handlePermissionAsk({ confirmId, sessionKey, tool, input, description, mode } = {}) {
    if (tool === "user_bash") {
      const result = await evaluateUserBash({
        spaceKey: sessionKey,
        command: input?.command,
        confirmId,
        mode,
      });
      if (result.verdict === "allow") return { kind: "allow" };
      return result.decision;
    }
    const ask = await authorize({ spaceKey: sessionKey, tool, input, description, confirmId });
    return ask.decision;
  }

  return { authorize, evaluateUserBash, evaluateBashToolCall, handlePermissionAsk };
}
